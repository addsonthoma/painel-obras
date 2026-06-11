/* =====================================================================
   PUXAR ORÇAMENTOS DO QUANTO SOBRA — via API interna (rápido, sem cliques)
   ---------------------------------------------------------------------
   COMO USAR:
   1) Abra o Quanto Sobra LOGADO, na tela Financeiro > Orçamento.
   2) Edite a lista NUMS abaixo com os números dos orçamentos.
   3) Cole tudo no Console (F12 > Console) e Enter — OU o Claude roda via MCP.
   4) Copie o resultado (array JSON) para um arquivo e rode:
        python scripts\importar_qs.py arquivo.json
   Funciona porque o fetch roda DENTRO da sua aba logada (o navegador anexa
   o login sozinho). Some quando a sessão do QS expira — basta relogar.
   ===================================================================== */
(async () => {
  const NUMS = ["933", "717"];   // <<< EDITE AQUI os números (sem "OR")

  // 1) tabela: mapeia número -> orcamento_id (período bem largo p/ pegar tudo)
  const tableUrl = "/ws.php?q=cruder&entity=orcamento&type=table&name=orcamento"
    + "&sEcho=1&iColumns=12&iDisplayStart=0&iDisplayLength=5000&mDataProp_0=num_orcamento"
    + "&sSearch=&data_inicio=01%2F01%2F2015&data_fim=31%2F12%2F2035";
  const t = await (await fetch(tableUrl, { credentials: "include" })).json();
  let rows = t.aaData; if (typeof rows === "string") rows = JSON.parse(rows);
  const map = {}; rows.forEach(r => { map[String(r.num)] = r.orcamento_id; });

  // 2) detalhe de cada um (cliente, valor, obs, telefone, materiais)
  const out = [];
  for (const n of NUMS) {
    const id = map[String(n)];
    if (!id) { out.push({ orcamento_qs: "OR" + n, erro: "nao encontrado" }); continue; }
    const d = await (await fetch("/ws.php?q=cruder&entity=orcamento&type=get&name=orcamento&orcamento_id=" + id, { credentials: "include" })).json();
    const o = d.ret.orcamento;
    const itens = (d.ret.mps || [])
      .filter(m => String(m.servico) === "0")          // 0 = material/produto, 1 = mão de obra
      .map(m => ({ produto: m.nome_produto, quantidade: Number(m.quantidade) || m.quantidade }));
    out.push({
      orcamento_qs: "OR" + n, cliente: o.clifor, valor_total: Number(o.valor) || null,
      telefone_cliente: (o.telefones || "").trim() || null, obs: (o.obs || "").trim() || null, itens
    });
  }
  return out;
})()
