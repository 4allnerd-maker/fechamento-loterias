#!/usr/bin/env node
// Atualiza o histórico de resultados da Lotofácil e Lotomania buscando na
// API pública da Caixa e gera os arquivos de texto (últimos 1000 concursos)
// no formato "concurso: dezenas", pronto para colar na ferramenta do site
// ou compartilhar em grupos.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LIMITE_EXPORT = 1000;
const PAUSA_MS = 150; // intervalo entre chamadas à API para não sobrecarregá-la

const JOGOS = [
  { nome: 'lotofacil', apiPath: 'lotofacil', digits: 2 },
  { nome: 'lotomania', apiPath: 'lotomania', digits: 2 },
];

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchConcurso(apiPath, numero) {
  const url = `https://servicebus2.caixa.gov.br/portaldeloterias/api/${apiPath}${numero ? '/' + numero : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${apiPath}/${numero ?? 'latest'}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.listaDezenas)) {
    throw new Error(`Resposta inesperada para ${apiPath}/${numero ?? 'latest'}`);
  }
  return {
    concurso: json.numero,
    data: json.dataApuracao,
    numeros: json.listaDezenas.map(Number).sort((a, b) => a - b),
  };
}

async function carregarHistorico(nome) {
  const file = path.join(DATA_DIR, `${nome}_historico.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(await readFile(file, 'utf8'));
}

async function salvarJSON(nome, historico) {
  const file = path.join(DATA_DIR, `${nome}_historico.json`);
  await writeFile(file, JSON.stringify(historico));
}

function formatarLinha(entry, digits) {
  const nums = entry.numeros.map((n) => String(n).padStart(digits, '0')).join(' ');
  return `${entry.concurso}: ${nums}`;
}

async function salvarTXT(nome, historico, digits) {
  const ultimos = historico.slice(-LIMITE_EXPORT).slice().reverse();
  const linhas = ultimos.map((e) => formatarLinha(e, digits));
  const file = path.join(DATA_DIR, `${nome}_ultimos1000.txt`);
  await writeFile(file, linhas.join('\n') + '\n');
}

async function atualizarJogo(jogo) {
  console.log(`\n=== ${jogo.nome} ===`);
  const historico = await carregarHistorico(jogo.nome);
  const porConcurso = new Map(historico.map((e) => [e.concurso, e]));
  const ultimoConhecido = historico.length ? Math.max(...historico.map((e) => e.concurso)) : 0;

  const atual = await fetchConcurso(jogo.apiPath, null);
  console.log(`Concurso mais recente disponível: ${atual.concurso} (${atual.data})`);

  const inicio = ultimoConhecido > 0 ? ultimoConhecido + 1 : Math.max(1, atual.concurso - LIMITE_EXPORT + 1);

  let novos = 0;
  for (let n = inicio; n < atual.concurso; n++) {
    if (porConcurso.has(n)) continue;
    try {
      const entry = await fetchConcurso(jogo.apiPath, n);
      porConcurso.set(n, entry);
      novos++;
    } catch (err) {
      console.warn(`  aviso: falhou concurso ${n}: ${err.message}`);
    }
    await esperar(PAUSA_MS);
  }
  if (!porConcurso.has(atual.concurso)) novos++;
  porConcurso.set(atual.concurso, atual);

  const historicoFinal = [...porConcurso.values()].sort((a, b) => a.concurso - b.concurso);
  await salvarJSON(jogo.nome, historicoFinal);
  await salvarTXT(jogo.nome, historicoFinal, jogo.digits);

  console.log(`${novos} concurso(s) novo(s) gravado(s). Histórico salvo: ${historicoFinal.length} concurso(s).`);
  return { ultimoConcurso: atual.concurso, data: atual.data, totalSalvo: historicoFinal.length };
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const meta = { geradoEm: new Date().toISOString(), jogos: {} };
  for (const jogo of JOGOS) {
    meta.jogos[jogo.nome] = await atualizarJogo(jogo);
  }
  await writeFile(path.join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log('\nConcluído.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
