import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ---------- COLE AQUI OS DADOS DO SEU PROJETO SUPABASE ----------
const SUPABASE_URL = "https://veqsfitqnyyhiyxknzem.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DP8GZBgQC5tCFPyqFTqXpg_rY6EpTeh";
// ------------------------------------------------------------------

const REST = `${SUPABASE_URL}/rest/v1`;
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

async function api(path, options = {}) {
  const res = await fetch(`${REST}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Erro na API: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const getConfig = () => api("/config?id=eq.1&select=*").then((r) => r[0]);
const getNumbers = () => api("/numeros?select=*&order=numero.asc");
const patchConfig = (body) =>
  api("/config?id=eq.1", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
const patchNumber = (numero, body) =>
  api(`/numeros?numero=eq.${numero}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
const resetNumbers = async (total) => {
  await api("/numeros?numero=gt.0", { method: "DELETE" });
  const rows = Array.from({ length: total }, (_, i) => ({ numero: i + 1, status: "livre" }));
  await api("/numeros", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
};

const money = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Sempre trabalha com 5 posições fixas (1º ao 5º lugar). Cada uma tem um texto
// e um "ativo" que decide se ela entra no sorteio e aparece pro cliente.
function normalizePremios(raw) {
  let arr = Array.isArray(raw) ? raw : [];
  arr = arr.map((p) =>
    typeof p === "string" ? { texto: p, ativo: true } : { texto: p?.texto || "", ativo: !!p?.ativo }
  );
  while (arr.length < 5) arr.push({ texto: "", ativo: false });
  return arr.slice(0, 5);
}
const PIX_KEY = "acougue.donaana@pix.com.br";

// ---------- LOGIN DO PAINEL ----------
// Hash SHA-256 da senha do admin. Senha padrão: acougue123
// Pra trocar a senha, gere um novo hash no console do navegador com:
// crypto.subtle.digest('SHA-256', new TextEncoder().encode('SUA-NOVA-SENHA')).then(b => console.log(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('')))
// e cole o resultado abaixo.
const ADMIN_PASSWORD_HASH = "8ca75ef4f0a8d0ffcb604fb447ba2b1dd9a7b5619effcce155bb41a1fad80e34";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function SorteioAcougue() {
  const [view, setView] = useState("cliente");
  const [config, setConfig] = useState(null);
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ nome: "", whats: "" });
  const [tick, setTick] = useState(0);
  const [winner, setWinner] = useState(null);
  const [toast, setToast] = useState(null);
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem("acougue_admin") === "1");
  const [loginError, setLoginError] = useState("");

  async function tryLogin(password) {
    const hash = await sha256(password);
    if (hash === ADMIN_PASSWORD_HASH) {
      localStorage.setItem("acougue_admin", "1");
      setIsAdmin(true);
      setLoginError("");
    } else {
      setLoginError("Senha incorreta.");
    }
  }

  function logout() {
    localStorage.removeItem("acougue_admin");
    setIsAdmin(false);
    setView("cliente");
  }

  const refresh = useCallback(async () => {
    try {
      const [c, n] = await Promise.all([getConfig(), getNumbers()]);
      setConfig(c);
      setNumbers(n);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // carga inicial + sincronização a cada 4s (simula tempo real via polling)
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  // libera reservas expiradas localmente e no banco
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const now = Date.now();
    numbers
      .filter((n) => n.status === "reservado" && n.expires_at && new Date(n.expires_at).getTime() < now)
      .forEach((n) => patchNumber(n.numero, { status: "livre", nome: null, whats: null, expires_at: null }));
    // eslint-disable-next-line
  }, [tick]);

  const stats = useMemo(() => {
    const vendidos = numbers.filter((n) => n.status === "vendido").length;
    const reservados = numbers.filter((n) => n.status === "reservado").length;
    return {
      vendidos,
      reservados,
      livres: numbers.length - vendidos - reservados,
      arrecadado: config ? vendidos * config.preco : 0,
    };
  }, [numbers, config]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  function pickNumber(n) {
    if (n.status !== "livre") return;
    setSelected(n.numero);
    setForm({ nome: "", whats: "" });
  }

  async function confirmReservation() {
    if (!form.nome.trim() || !form.whats.trim()) {
      showToast("Preencha nome e WhatsApp antes de continuar.");
      return;
    }
    const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    try {
      await patchNumber(selected, { status: "reservado", nome: form.nome, whats: form.whats, expires_at });
      showToast(`Número ${selected} reservado por 15 minutos.`);
      setSelected(null);
      refresh();
    } catch {
      showToast("Não foi possível reservar. Tente de novo.");
    }
  }

  async function confirmPayment(n) {
    await patchNumber(n, { status: "vendido", expires_at: null });
    showToast(`Número ${n} confirmado como vendido.`);
    refresh();
  }

  async function releaseNumber(n) {
    await patchNumber(n, { status: "livre", nome: null, whats: null, expires_at: null });
    refresh();
  }

  async function saveConfig(patch) {
    try {
      const updated = await patchConfig(patch);
      if (!updated || !updated[0]) throw new Error("resposta vazia do servidor");
      setConfig(updated[0]);
      showToast("Salvo com sucesso.");
    } catch (e) {
      showToast("Erro ao salvar: " + e.message);
      console.error("Erro ao salvar config:", e);
    }
  }

  async function changeTotal(total) {
    await saveConfig({ total });
    await resetNumbers(total);
    refresh();
    showToast("Grade de números reiniciada.");
  }

  async function sortear() {
    const premios = normalizePremios(config.premios).filter((p) => p.ativo && p.texto.trim());
    const pool = numbers.filter((n) => n.status === "vendido");
    if (pool.length === 0) return showToast("Ainda não há números vendidos.");
    if (premios.length === 0) return showToast("Marque e preencha ao menos um prêmio antes de sortear.");
    if (pool.length < premios.length) {
      showToast(`Só há ${pool.length} número(s) vendido(s) para ${premios.length} prêmio(s). Sorteando o possível.`);
    }
    const restante = [...pool];
    const resultado = [];
    for (let i = 0; i < premios.length && restante.length > 0; i++) {
      const idx = Math.floor(Math.random() * restante.length);
      const [ganhador] = restante.splice(idx, 1);
      resultado.push({ lugar: i + 1, premio: premios[i].texto, numero: ganhador.numero, nome: ganhador.nome });
    }
    await patchConfig({ resultado });
    setConfig((c) => ({ ...c, resultado }));
    setWinner(resultado);
  }

  if (loading) return <div style={S.page}>Carregando dados do sorteio...</div>;
  if (loadError)
    return (
      <div style={S.page}>
        <p><strong>Não consegui falar com o Supabase.</strong></p>
        <p style={S.pSmall}>
          Verifique se SUPABASE_URL e SUPABASE_ANON_KEY estão preenchidos corretamente no topo do
          arquivo, e se as tabelas foram criadas. Detalhe: {loadError}
        </p>
      </div>
    );

  const selectedNum = numbers.find((n) => n.numero === selected);
  const reservas = numbers.filter((n) => n.status === "reservado");
  const vendas = numbers.filter((n) => n.status === "vendido");

  return (
    <div style={S.page}>
      <style>{`
        @keyframes riseIn { from { opacity:0; transform: translateY(6px);} to {opacity:1; transform:none;} }
        .fadein { animation: riseIn .25s ease-out; }
        .num-btn { transition: transform .12s ease; }
        .num-btn:hover:not(:disabled) { transform: translateY(-2px); }
        input:focus { outline: 2px solid #7A1F1F; outline-offset: 1px; }
      `}</style>

      <header style={S.header}>
        <div>
          <div style={S.eyebrow}>Casa de Carnes Dona Ana</div>
          <h1 style={S.h1}>Sorteio do açougue</h1>
        </div>
        <div style={S.tabs}>
          <button style={view === "cliente" ? S.tabActive : S.tab} onClick={() => setView("cliente")}>
            Área do cliente
          </button>
          <button style={view === "painel" ? S.tabActive : S.tab} onClick={() => setView("painel")}>
            Painel do açougue
          </button>
        </div>
      </header>

      {toast && <div style={S.toast} className="fadein">{toast}</div>}

      {winner && (
        <div style={S.winnerBanner} className="fadein">
          <div>
            {winner.map((w) => (
              <div key={w.lugar} style={{ marginBottom: 4 }}>
                <strong>{w.lugar}º lugar</strong> — {w.premio}: número {w.numero} ({w.nome || "aguardando confirmação"})
              </div>
            ))}
          </div>
          <button style={S.linkBtn} onClick={() => setWinner(null)}>fechar</button>
        </div>
      )}

      {view === "cliente" ? (
        <ClienteView config={config} numbers={numbers} stats={stats} onPick={pickNumber} />
      ) : !isAdmin ? (
        <LoginView onLogin={tryLogin} error={loginError} />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button style={S.linkBtn} onClick={logout}>sair do painel</button>
          </div>
          <PainelView
            config={config}
            stats={stats}
            reservas={reservas}
            vendas={vendas}
            onConfirm={confirmPayment}
            onRelease={releaseNumber}
            onSortear={sortear}
            onSaveConfig={saveConfig}
            onChangeTotal={changeTotal}
          />
        </>
      )}

      {selectedNum && (
        <div style={S.overlay} onClick={() => setSelected(null)}>
          <div style={S.modal} className="fadein" onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHead}>
              <span style={S.modalNum}>Número {selectedNum.numero}</span>
              <button style={S.linkBtn} onClick={() => setSelected(null)}>fechar</button>
            </div>
            <p style={S.p}>Valor: <strong>{money(config.preco)}</strong></p>
            <div style={S.pixBox}>
              <div style={S.pixLabel}>Chave Pix (copia e cola)</div>
              <div style={S.pixKey}>{PIX_KEY}</div>
              <button
                style={S.copyBtn}
                onClick={() => { navigator.clipboard?.writeText(PIX_KEY); showToast("Chave Pix copiada."); }}
              >
                Copiar chave
              </button>
            </div>
            <p style={S.pSmall}>
              Envie exatamente {money(config.preco)} e mande o comprovante no WhatsApp do açougue.
              Seu número fica reservado por 15 minutos.
            </p>
            <label style={S.label}>Seu nome</label>
            <input style={S.input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" />
            <label style={S.label}>WhatsApp</label>
            <input style={S.input} value={form.whats} onChange={(e) => setForm({ ...form, whats: e.target.value })} placeholder="(11) 99999-0000" />
            <button style={S.primaryBtn} onClick={confirmReservation}>Reservar número</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LoginView({ onLogin, error }) {
  const [password, setPassword] = useState("");
  return (
    <div className="fadein" style={S.panelCard}>
      <h2 style={S.h2}>Painel do açougue</h2>
      <p style={S.pSmall}>Digite a senha de acesso pra ver reservas, confirmar pagamentos e configurar o sorteio.</p>
      <label style={S.label}>Senha</label>
      <input
        style={S.input}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onLogin(password)}
        placeholder="Senha do painel"
      />
      {error && <p style={{ ...S.pSmall, color: "#7A1F1F", marginTop: 6 }}>{error}</p>}
      <button style={S.primaryBtn} onClick={() => onLogin(password)}>Entrar</button>
    </div>
  );
}

function ClienteView({ config, numbers, stats, onPick }) {
  return (
    <div className="fadein">
      <section style={S.infoCard}>
        <div>
          <div style={S.infoLabel}>Prêmios</div>
          <div style={S.infoValue}>
            {normalizePremios(config.premios)
              .filter((p) => p.ativo && p.texto.trim())
              .map((p, i) => <div key={i}>{i + 1}º — {p.texto}</div>)}
          </div>
        </div>
        <div><div style={S.infoLabel}>Preço por número</div><div style={S.infoValue}>{money(config.preco)}</div></div>
        <div><div style={S.infoLabel}>Sorteio</div><div style={S.infoValue}>{new Date(config.data + "T00:00:00").toLocaleDateString("pt-BR")} · Loteria Federal</div></div>
        <div><div style={S.infoLabel}>Disponíveis</div><div style={S.infoValue}>{stats.livres} de {numbers.length}</div></div>
      </section>

      <div style={S.legend}>
        <span style={S.legendItem}><i style={{ ...S.dot, background: COLORS.livre }} /> livre</span>
        <span style={S.legendItem}><i style={{ ...S.dot, background: COLORS.reservado }} /> reservado</span>
        <span style={S.legendItem}><i style={{ ...S.dot, background: COLORS.vendido }} /> vendido</span>
      </div>

      <div style={S.grid}>
        {numbers.map((num) => (
          <button
            key={num.numero}
            className="num-btn"
            disabled={num.status !== "livre"}
            onClick={() => onPick(num)}
            style={{ ...S.numCell, background: COLORS[num.status], color: num.status === "livre" ? "#2A2420" : "#F6EFE4", cursor: num.status === "livre" ? "pointer" : "default" }}
          >
            {num.numero}
          </button>
        ))}
      </div>
    </div>
  );
}

function PainelView({ config, stats, reservas, vendas, onConfirm, onRelease, onSortear, onSaveConfig, onChangeTotal }) {
  const [local, setLocal] = useState(config);
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && config) {
      setLocal(config);
      initialized.current = true;
    }
  }, [config]);

  return (
    <div className="fadein">
      <section style={S.statsRow}>
        <Stat label="Arrecadado" value={money(stats.arrecadado)} />
        <Stat label="Vendidos" value={stats.vendidos} />
        <Stat label="Reservados" value={stats.reservados} />
        <Stat label="Livres" value={stats.livres} />
      </section>

      <section style={S.panelCard}>
        <h2 style={S.h2}>Configurar sorteio</h2>

        <label style={S.label}>Prêmios — marque quais entram nesse sorteio (até 5)</label>
        {normalizePremios(local.premios).map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={p.ativo}
              onChange={(e) => {
                const premios = normalizePremios(local.premios);
                premios[i] = { ...premios[i], ativo: e.target.checked };
                setLocal({ ...local, premios });
              }}
              style={{ width: 18, height: 18, flexShrink: 0 }}
            />
            <span style={{ fontSize: 12.5, color: "#8A7F6B", minWidth: 22 }}>{i + 1}º</span>
            <input
              style={S.input}
              value={p.texto}
              disabled={!p.ativo}
              onChange={(e) => {
                const premios = normalizePremios(local.premios);
                premios[i] = { ...premios[i], texto: e.target.value };
                setLocal({ ...local, premios });
              }}
              placeholder={`Prêmio do ${i + 1}º lugar`}
            />
          </div>
        ))}
        <div style={{ marginBottom: 14 }}>
          <button style={S.confirmBtn} onClick={() => onSaveConfig({ premios: normalizePremios(local.premios) })}>
            Salvar prêmios
          </button>
        </div>

        <div style={S.formRow}>
          <div>
            <label style={S.label}>Preço por número</label>
            <input style={S.input} type="number" value={local.preco} onChange={(e) => setLocal({ ...local, preco: Number(e.target.value) || 0 })} onBlur={() => onSaveConfig({ preco: local.preco })} />
          </div>
          <div>
            <label style={S.label}>Data do sorteio</label>
            <input style={S.input} type="date" value={local.data} onChange={(e) => { setLocal({ ...local, data: e.target.value }); onSaveConfig({ data: e.target.value }); }} />
          </div>
        </div>
        <div style={S.formRow}>
          <div>
            <label style={S.label}>Quantidade de números</label>
            <input style={S.input} type="number" value={local.total} onChange={(e) => setLocal({ ...local, total: Number(e.target.value) || 1 })} onBlur={() => onChangeTotal(local.total)} />
          </div>
          <div style={{ alignSelf: "flex-end" }}>
            <button style={S.primaryBtn} onClick={onSortear}>Realizar sorteio agora</button>
          </div>
        </div>
        <p style={S.pSmall}>Alterar a quantidade de números apaga e recria a grade no banco de dados.</p>
      </section>

      <section style={S.panelCard}>
        <h2 style={S.h2}>Reservas aguardando confirmação ({reservas.length})</h2>
        {reservas.length === 0 && <p style={S.pSmall}>Nenhuma reserva pendente no momento.</p>}
        {reservas.map((r) => (
          <div key={r.numero} style={S.rowItem}>
            <div><strong>Número {r.numero}</strong> — {r.nome} · {r.whats}</div>
            <div style={S.rowActions}>
              <button style={S.confirmBtn} onClick={() => onConfirm(r.numero)}>Marcar como pago</button>
              <button style={S.releaseBtn} onClick={() => onRelease(r.numero)}>Liberar número</button>
            </div>
          </div>
        ))}
      </section>

      <section style={S.panelCard}>
        <h2 style={S.h2}>Números vendidos ({vendas.length})</h2>
        {vendas.length === 0 && <p style={S.pSmall}>Nenhuma venda confirmada ainda.</p>}
        <div style={S.soldWrap}>
          {vendas.map((v) => <span key={v.numero} style={S.soldChip}>{v.numero} · {v.nome}</span>)}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={S.statBox}>
      <div style={S.statValue}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

const COLORS = { livre: "#DDE3C6", reservado: "#C98A2C", vendido: "#7A1F1F" };

const S = {
  page: { fontFamily: "system-ui, -apple-system, sans-serif", background: "#F6EFE4", color: "#2A2420", padding: "20px 16px 60px", minHeight: "100%", maxWidth: 720, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, borderBottom: "2px solid #2A2420", paddingBottom: 14, marginBottom: 18 },
  eyebrow: { fontSize: 12, letterSpacing: 0.4, color: "#7A1F1F", fontWeight: 500 },
  h1: { fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 26, margin: "4px 0 0", fontWeight: 700 },
  h2: { fontFamily: "Georgia, serif", fontSize: 17, margin: "0 0 12px", fontWeight: 700 },
  tabs: { display: "flex", gap: 8 },
  tab: { background: "transparent", border: "1.5px solid #2A2420", borderRadius: 999, padding: "7px 14px", fontSize: 13, cursor: "pointer", color: "#2A2420" },
  tabActive: { background: "#2A2420", border: "1.5px solid #2A2420", borderRadius: 999, padding: "7px 14px", fontSize: 13, cursor: "pointer", color: "#F6EFE4" },
  infoCard: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, background: "#FFFDF8", border: "1px solid #E4DAC6", borderRadius: 12, padding: 16, marginBottom: 16 },
  infoLabel: { fontSize: 11, color: "#8A7F6B", marginBottom: 2 },
  infoValue: { fontSize: 14, fontWeight: 600 },
  legend: { display: "flex", gap: 16, marginBottom: 10, fontSize: 12, color: "#5C5344" },
  legendItem: { display: "flex", alignItems: "center", gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 999, display: "inline-block" },
  grid: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 },
  numCell: { aspectRatio: "1", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600 },
  overlay: { position: "fixed", inset: 0, background: "rgba(42,36,32,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 },
  modal: { background: "#FFFDF8", borderRadius: 14, padding: 20, width: "100%", maxWidth: 380 },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  modalNum: { fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 },
  p: { fontSize: 14, margin: "6px 0" },
  pSmall: { fontSize: 12.5, color: "#7A6F5C", lineHeight: 1.5 },
  pixBox: { background: "#F1EAD9", border: "1px dashed #C98A2C", borderRadius: 10, padding: 12, margin: "10px 0" },
  pixLabel: { fontSize: 11, color: "#8A7F6B", marginBottom: 4 },
  pixKey: { fontSize: 13.5, fontWeight: 600, wordBreak: "break-all", marginBottom: 8 },
  copyBtn: { background: "#2A2420", color: "#F6EFE4", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" },
  label: { display: "block", fontSize: 12, color: "#5C5344", margin: "10px 0 4px" },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #D8CCB4", borderRadius: 8, padding: "9px 10px", fontSize: 14, background: "#fff", color: "#2A2420" },
  primaryBtn: { marginTop: 14, width: "100%", background: "#7A1F1F", color: "#F6EFE4", border: "none", borderRadius: 8, padding: "11px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  linkBtn: { background: "none", border: "none", color: "#7A1F1F", fontSize: 13, cursor: "pointer", textDecoration: "underline" },
  toast: { position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: "#2A2420", color: "#F6EFE4", padding: "10px 16px", borderRadius: 999, fontSize: 13, zIndex: 20, boxShadow: "0 6px 18px rgba(0,0,0,0.25)" },
  winnerBanner: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#C98A2C", color: "#2A2420", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 14 },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 },
  statBox: { background: "#FFFDF8", border: "1px solid #E4DAC6", borderRadius: 10, padding: "12px 8px", textAlign: "center" },
  statValue: { fontSize: 16, fontWeight: 700 },
  statLabel: { fontSize: 11, color: "#8A7F6B", marginTop: 2 },
  panelCard: { background: "#FFFDF8", border: "1px solid #E4DAC6", borderRadius: 12, padding: 16, marginBottom: 16 },
  formRow: { display: "flex", gap: 10, marginBottom: 4, flexWrap: "wrap" },
  rowItem: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "10px 0", borderTop: "1px solid #EFE7D6", fontSize: 13.5 },
  rowActions: { display: "flex", gap: 8 },
  confirmBtn: { background: "#3B5A2A", color: "#F6EFE4", border: "none", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, cursor: "pointer" },
  releaseBtn: { background: "transparent", color: "#7A1F1F", border: "1px solid #7A1F1F", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, cursor: "pointer" },
  soldWrap: { display: "flex", flexWrap: "wrap", gap: 8 },
  soldChip: { background: "#F1EAD9", borderRadius: 999, padding: "5px 10px", fontSize: 12 },
};
