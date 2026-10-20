import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Ao, Etapa, Fundo } from '../types'

const INICIAL: Ao = {
  fase: 'parado',
  inicio: null,
  aguardandoMotivo: null,
  acoes: 0,
  rodando: [],
  ultimaAtividade: null,
  etapas: [],
  etapasInicio: null,
  ultimoTurno: null,
  fundo: [],
  turnoDeAviso: false,
}

const ao = atom({ plugin: 'status-sessao', key: 'ao' } as const, INICIAL)
const pulso = atom({ plugin: 'status-sessao', key: 'pulso' } as const, 0)

type Motor = Parameters<typeof read>[0]

const FERRAMENTA = 'progresso'
const FERRAMENTA_COMPLETA = `mcp__status-sessao__${FERRAMENTA}`

const GIRO = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const ICONE_FUNDO: Record<Fundo['tipo'], string> = { agente: '⇢', comando: '❯', monitor: '◎', outro: '•' }
const NOME_FUNDO: Record<Fundo['tipo'], string> = { agente: 'agente', comando: 'comando', monitor: 'monitor', outro: 'tarefa' }
const MAX_FUNDO = 4
const ENCERRADO = new Set(['completed', 'failed', 'killed'])

function iconeDe(tool: string): string {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return '❯'
    case 'Read':
    case 'WebFetch':
      return '≡'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return '✎'
    case 'Grep':
    case 'Glob':
    case 'WebSearch':
    case 'ToolSearch':
      return '⌕'
    case 'Agent':
    case 'Task':
      return '⇢'
    case 'AskUserQuestion':
      return '?'
  }
  return '•'
}

const SECAO = [
  'Barra de status (mod status-sessao): a pessoa vê, acima do campo de mensagem, uma barra com o progresso do seu trabalho.',
  `Quando o pedido tiver 3 ou mais etapas, chame ${FERRAMENTA_COMPLETA} logo no início com o plano (títulos curtos, em português) e chame de novo sempre que começar ou concluir uma etapa, passando a lista inteira com o status de cada uma.`,
  'Em pedidos de uma etapa só, não chame. A ferramenta só alimenta a barra: não comente sobre ela na resposta.',
].join(' ')

function nomeArquivo(caminho: unknown): string {
  if (typeof caminho !== 'string' || caminho === '') return 'arquivo'
  const partes = caminho.split(/[\\/]/)
  return partes[partes.length - 1] || caminho
}

function encurtar(texto: unknown, max = 60): string {
  const t = typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim() : ''
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function rotuloDe(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return `Rodando comando: ${encurtar(args.description || args.command)}`
    case 'Read':
      return `Lendo ${nomeArquivo(args.file_path)}`
    case 'Edit':
    case 'NotebookEdit':
      return `Editando ${nomeArquivo(args.file_path ?? args.notebook_path)}`
    case 'Write':
      return `Escrevendo ${nomeArquivo(args.file_path)}`
    case 'Grep':
    case 'Glob':
      return 'Procurando no código'
    case 'WebSearch':
      return `Pesquisando na web: ${encurtar(args.query, 50)}`
    case 'WebFetch':
      return 'Lendo uma página da web'
    case 'Agent':
    case 'Task':
      return `Delegando a um subagente: ${encurtar(args.description, 50)}`
    case 'Skill':
      return `Carregando a skill ${encurtar(args.skill, 40)}`
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TodoWrite':
    case FERRAMENTA_COMPLETA:
      return 'Atualizando o plano de etapas'
    case 'ToolSearch':
      return 'Carregando ferramentas'
    case 'AskUserQuestion':
      return 'Fazendo uma pergunta a você'
  }
  if (tool.startsWith('mcp__')) {
    const partes = tool.split('__')
    return `Usando ${partes.slice(2).join('__') || tool} (${partes[1]})`
  }
  return `Usando ${tool}`
}

function duracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

function deStatus(status: unknown): Etapa['status'] {
  if (status === 'completed' || status === 'feita') return 'feita'
  if (status === 'in_progress' || status === 'andamento') return 'andamento'
  return 'pendente'
}

function idDoResultado(ran: unknown): string | null {
  const id = (ran as { result?: { task?: { id?: unknown } } } | null)?.result?.task?.id
  return typeof id === 'string' ? id : null
}

function tipoDe(tipo: unknown): Fundo['tipo'] {
  const t = String(tipo)
  if (/agent/.test(t)) return 'agente'
  if (t === 'shell' || /bash/.test(t)) return 'comando'
  if (t === 'monitor') return 'monitor'
  return 'outro'
}

function fundoDe(s: Ao): Fundo[] {
  return s.fundo ?? []
}

// O que uma chamada deixou rodando em segundo plano, lido do resultado da ferramenta.
function lancadoPor(tool: string, args: Record<string, unknown>, result: unknown, agora: number): Fundo | null {
  if (result === null || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  if ((tool === 'Agent' || tool === 'Task') && (r.status === 'async_launched' || r.status === 'remote_launched')) {
    if (typeof r.agentId !== 'string') return null
    return { id: r.agentId, tipo: 'agente', rotulo: encurtar(args.description || r.description, 50) || 'subagente', desde: agora }
  }
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof r.backgroundTaskId === 'string') {
    return { id: r.backgroundTaskId, tipo: 'comando', rotulo: encurtar(args.description || args.command, 50), desde: agora }
  }
  if (tool === 'Monitor' && typeof r.taskId === 'string') {
    return { id: r.taskId, tipo: 'monitor', rotulo: encurtar(args.description || args.command, 50) || 'monitor', desde: agora }
  }
  if (tool === 'Workflow' && typeof r.taskId === 'string') {
    return { id: r.taskId, tipo: 'outro', rotulo: encurtar(r.workflowName, 50) || 'workflow', desde: agora }
  }
  return null
}

// Ids das tarefas que um aviso dá por encerradas. O aviso de um monitor que só
// relata um evento não traz status de fim e não tira nada da lista.
function encerradosNoAviso(texto: string): string[] {
  const ids: string[] = []
  for (const bloco of texto.split('<task-notification>').slice(1)) {
    const id = /<task-id>\s*([^<]+?)\s*<\/task-id>/.exec(bloco)?.[1]
    const status = /<status>\s*([^<]+?)\s*<\/status>/.exec(bloco)?.[1]
    const segueEsperando = /waiting on its own background work|background work of its own still running/i.test(bloco)
    if (id && status && !segueEsperando && /^(completed|failed|killed|stopped|cancell?ed|error)$/i.test(status)) ids.push(id)
  }
  return ids
}

// Espelho de "há algo em segundo plano?", para os relógios não lerem o estado a cada tique.
let temFundo = false

function mudar($: Motor, fn: (s: Ao) => Ao) {
  return update($, ao, (s): Ao => {
    const novo = fn(s)
    temFundo = fundoDe(novo).length > 0
    return novo
  })
}

// Um subagente pode encerrar o turno e seguir esperando trabalho próprio em
// segundo plano: o aviso e o fim do turno dele dizem "completed" cedo demais.
// Só sai da lista o subagente que o motor dá por encerrado (ou já não lista).
async function confirmarFim($: Motor, ids: string[]) {
  if (ids.length === 0) return
  const agentes = await $.agent.list()
  const vivos = new Set(agentes.filter(a => !ENCERRADO.has(a.status)).map(a => a.id))
  await tirarDoFundo($, ids.filter(id => !vivos.has(id)))
}

function tirarDoFundo($: Motor, ids: string[]) {
  return mudar($, s => {
    const fundo = fundoDe(s)
    const resto = fundo.filter(x => !ids.includes(x.id))
    return resto.length === fundo.length ? s : { ...s, fundo: resto }
  })
}

export const register: Register = on => {
  let estaTrabalhando = false
  let proximoEhAviso = false

  on('session.start', async ($, e, next) => {
    const s = await read($, ao)
    estaTrabalhando = s.fase !== 'parado'
    temFundo = fundoDe(s).length > 0
    $.clock.every(400, () => {
      if (estaTrabalhando) void update($, pulso, n => n + 1)
    })
    // Parado com tarefas em segundo plano: o relógio de cada uma segue andando.
    $.clock.every(1000, () => {
      if (!estaTrabalhando && temFundo) void update($, pulso, n => n + 1)
    })
    // Rede de segurança: subagente que já terminou sai da lista mesmo que o aviso demore.
    $.clock.every(5000, () => {
      if (!temFundo) return
      void $.agent.list().then(agentes => {
        const fim = agentes.filter(a => ENCERRADO.has(a.status)).map(a => a.id)
        if (fim.length > 0) return tirarDoFundo($, fim)
      })
    })
    await $.tool.register({
      name: FERRAMENTA,
      description:
        'Atualiza a barra de progresso que a pessoa vê acima do campo de mensagem. Passe a lista inteira de etapas do pedido atual, cada uma com o status pendente, andamento ou feita. Use em pedidos de 3 ou mais etapas: no início e a cada etapa iniciada ou concluída.',
      inputSchema: {
        type: 'object',
        properties: {
          etapas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                titulo: { type: 'string', description: 'Título curto da etapa' },
                status: { type: 'string', enum: ['pendente', 'andamento', 'feita'] },
              },
              required: ['titulo', 'status'],
            },
          },
        },
        required: ['etapas'],
      },
      isDeferred: false,
    })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composto = await next(e)
    if (!e.tools.includes(FERRAMENTA_COMPLETA)) return composto

    return {
      sections: [...composto.sections, { id: 'status-sessao:progresso', text: SECAO, scope: 'session' }],
    }
  })

  // Aviso de tarefa em segundo plano: tira da lista o que terminou e marca o
  // turno que ele abrir, para a barra não trocar de cara a cada aviso.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const fim = encerradosNoAviso(e.text)
      await confirmarFim($, fim)
      if (e.turnId === undefined) proximoEhAviso = true
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const agora = await $.clock.now()
      const isAviso = proximoEhAviso
      proximoEhAviso = false
      estaTrabalhando = true
      await mudar($, (s): Ao => {
        const tudoFeito = s.etapas.length > 0 && s.etapas.every(x => x.status === 'feita')
        return {
          ...s,
          fase: 'trabalhando',
          inicio: agora,
          aguardandoMotivo: null,
          acoes: 0,
          rodando: [],
          ultimaAtividade: null,
          etapas: tudoFeito ? [] : s.etapas,
          etapasInicio: tudoFeito ? null : s.etapasInicio,
          turnoDeAviso: isAviso,
        }
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const agora = await $.clock.now()
      estaTrabalhando = false
      await mudar($, (s): Ao => ({
        ...s,
        fase: 'parado',
        aguardandoMotivo: null,
        rodando: [],
        turnoDeAviso: false,
        // Um turno que só leu um aviso, sem agir, não apaga o resumo do último trabalho.
        ultimoTurno:
          s.turnoDeAviso && s.acoes === 0 && s.ultimoTurno !== null && e.reason === 'answer'
            ? s.ultimoTurno
            : {
                segundos: s.inicio === null ? 0 : Math.round((agora - s.inicio) / 1000),
                acoes: s.acoes,
                motivo: e.reason,
              },
      }))
    } else {
      await confirmarFim($, [e.agentId])
    }

    return next(e)
  })

  // A lista oficial do que segue rodando quando o turno principal termina.
  on('classic.Stop', async ($, e, next) => {
    const lista = e.background_tasks
    if (Array.isArray(lista)) {
      const agora = await $.clock.now()
      await mudar($, (s): Ao => {
        const antes = new Map(fundoDe(s).map(x => [x.id, x]))
        return {
          ...s,
          fundo: lista.map(t => {
            const ja = antes.get(t.id)
            return {
              id: t.id,
              tipo: ja?.tipo ?? tipoDe(t.type),
              rotulo: ja?.rotulo || encurtar(t.description || t.command || t.type, 50),
              desde: ja?.desde ?? agora,
              ...(ja?.agora ? { agora: ja.agora } : {}),
            }
          }),
        }
      })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    await update($, ao, (s): Ao => ({
      ...s,
      fase: 'aguardando',
      aguardandoMotivo: `sua aprovação para ${rotuloDe(e.tool_name, {}).replace(/^Usando /, '')}`,
    }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__status-sessao__progresso' }, async ($, e) => {
    const lista = (e as unknown as { etapas?: unknown }).etapas
    if (!Array.isArray(lista)) return { deny: 'Passe "etapas" como uma lista de { titulo, status }.' }
    const agora = await $.clock.now()
    const etapas: Etapa[] = lista.map((x, i) => ({
      id: `p${i}`,
      titulo: encurtar((x as { titulo?: unknown }).titulo, 80) || `Etapa ${i + 1}`,
      status: deStatus((x as { status?: unknown }).status),
    }))
    await update($, ao, s => ({ ...s, etapas, etapasInicio: s.etapasInicio ?? agora }))

    return { result: 'Barra de progresso atualizada.' }
  }).catch(() => ({ result: 'Barra de progresso não atualizada.' }))

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Record<string, unknown>
    const nome = String(e.tool)
    const rotulo = rotuloDe(nome, args)
    const isSubagente = e.agentId !== undefined
    const espera =
      e.tool === 'AskUserQuestion' ? 'sua resposta a uma pergunta' : nome === 'ExitPlanMode' ? 'sua aprovação do plano' : null

    await update($, ao, s => ({
      ...s,
      acoes: s.acoes + 1,
      rodando: [...s.rodando, { id: e.tool_use_id, rotulo, icone: iconeDe(nome), isSubagente }].slice(-20),
      ultimaAtividade: rotulo,
      // Um subagente em segundo plano mostra, na lista, o que está fazendo agora.
      fundo: isSubagente ? fundoDe(s).map(x => (x.id === e.agentId ? { ...x, agora: rotulo } : x)) : s.fundo,
      ...(espera !== null && !isSubagente ? { fase: 'aguardando' as const, aguardandoMotivo: espera } : {}),
    }))

    const ran = await next(e)

    const agora = await $.clock.now()
    const isOk = !('deny' in ran && ran.deny !== undefined) && ran.isError !== true
    const lancado = isOk ? lancadoPor(nome, args, ran.result, agora) : null
    const parado = isOk && nome === 'TaskStop' ? String(args.task_id ?? args.shell_id ?? '') : ''
    await mudar($, (s): Ao => {
      let etapas = s.etapas
      if (isOk && e.tool === 'TodoWrite') {
        etapas = e.todos.map((t, i) => ({ id: `t${i}`, titulo: encurtar(t.content, 80), status: deStatus(t.status) }))
      } else if (isOk && e.tool === 'TaskCreate') {
        const id = idDoResultado(ran) ?? `c${s.etapas.length}`
        etapas = [...s.etapas, { id, titulo: encurtar(e.subject, 80), status: 'pendente' }]
      } else if (isOk && e.tool === 'TaskUpdate') {
        etapas =
          e.status === 'deleted'
            ? s.etapas.filter(x => x.id !== e.taskId)
            : s.etapas.map(x =>
                x.id === e.taskId
                  ? {
                      ...x,
                      titulo: e.subject ? encurtar(e.subject, 80) : x.titulo,
                      status: e.status ? deStatus(e.status) : x.status,
                    }
                  : x,
              )
      }
      const mudouPlano = etapas !== s.etapas
      let fundo = fundoDe(s)
      if (lancado !== null) fundo = [...fundo.filter(x => x.id !== lancado.id), lancado]
      if (parado !== '') fundo = fundo.filter(x => x.id !== parado)

      return {
        ...s,
        fase: s.fase === 'parado' ? 'parado' : 'trabalhando',
        aguardandoMotivo: null,
        rodando: s.rodando.filter(x => x.id !== e.tool_use_id),
        etapas,
        etapasInicio: mudouPlano ? (s.etapasInicio ?? agora) : s.etapasInicio,
        fundo,
      }
    })


    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const s = await read($, ao)
    const giro = await read($, pulso)
    const agora = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    const fundo = fundoDe(s)

    const total = s.etapas.length
    const feitas = s.etapas.filter(x => x.status === 'feita').length
    const atual = s.etapas.find(x => x.status === 'andamento')

    // Estado 2: turno encerrado, mas há tarefas em segundo plano. Um turno aberto
    // só para ler um aviso, enquanto não age, fica nesta mesma moldura.
    const isLendoAviso = e.props.isWorking && s.turnoDeAviso === true && s.acoes === 0
    if ((!e.props.isWorking && fundo.length > 0) || isLendoAviso) {
      const n = fundo.length
      const cor = 'suggestion'
      const visiveis = fundo.slice(0, MAX_FUNDO)
      const resto = n - visiveis.length
      const contagem =
        n === 0 ? 'nada mais rodando' : `${n} ${n === 1 ? 'tarefa ainda rodando' : 'tarefas ainda rodando'}`

      return (
        <Box flexDirection="column" borderStyle="round" borderColor={cor} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text color={cor}>{GIRO[giro % GIRO.length]} </Text>
              <Text backgroundColor={cor} color="inverseText" weight="bold">
                {isLendoAviso ? ' LENDO AVISO ' : ' EM SEGUNDO PLANO '}
              </Text>
            </Text>
            <Text dimColor>{contagem}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {isLendoAviso
              ? 'Uma tarefa em segundo plano mandou notícia; Claude está lendo.'
              : 'Turno encerrado: você já pode escrever, o resultado chega sozinho.'}
          </Text>
          {visiveis.map(x => (
            <Box flexDirection="row" justifyContent="space-between">
              <Text wrap="truncate-end">
                <Text color={cor}>{ICONE_FUNDO[x.tipo]} </Text>
                <Text dimColor>{NOME_FUNDO[x.tipo].padEnd(8)}</Text>
                <Text>{x.rotulo}</Text>
                {x.agora ? <Text dimColor>{` · ${x.agora}`}</Text> : null}
              </Text>
              <Text dimColor tabular>{` ${duracao(agora - x.desde)}`}</Text>
            </Box>
          ))}
          {resto > 0 ? <Text dimColor>{`+${resto} ${resto === 1 ? 'outra' : 'outras'}`}</Text> : null}
        </Box>
      )
    }

    // Estado 3: pronto de verdade, nada rodando.
    if (!e.props.isWorking) {
      if (s.ultimoTurno === null) return next(e)
      const t = s.ultimoTurno
      const [icone, cor, titulo] =
        t.motivo === 'aborted'
          ? ['■', 'warning', 'Interrompido']
          : t.motivo === 'error'
            ? ['✕', 'error', 'Parou com erro']
            : ['✓', 'success', 'Pronto, sua vez']
      const plano = total > 0 && feitas < total ? ` · plano em ${feitas} de ${total}` : ''

      return (
        <Box paddingX={1}>
          <Text wrap="truncate-end">
            <Text color={cor} weight="bold">
              {icone} {titulo}
            </Text>
            <Text dimColor>
              {'  '}último trabalho: {duracao(t.segundos * 1000)} · {t.acoes} {t.acoes === 1 ? 'ação' : 'ações'}
              {plano} · nada rodando
            </Text>
          </Text>
        </Box>
      )
    }

    // Estado 1: trabalhando no turno.
    const isAguardando = s.fase === 'aguardando'
    const cor = isAguardando ? 'warning' : 'claude'
    const decorrido = s.inicio === null ? null : agora - s.inicio
    const ultimo = s.rodando[s.rodando.length - 1]
    const [icone, fazendo] = isAguardando
      ? ['?', `Esperando ${s.aguardandoMotivo ?? 'você'}`]
      : ultimo
        ? [ultimo.icone, `${ultimo.isSubagente ? 'subagente · ' : ''}${ultimo.rotulo}`]
        : ['…', 'Pensando e escrevendo a resposta']
    const paralelo = !isAguardando && s.rodando.length > 1 ? `+${s.rodando.length - 1} em paralelo` : ''

    const largura = Math.max(12, Math.min(40, e.props.bodyColumns - 36))
    const fracao = total === 0 ? 0 : Math.min(1, (feitas + (atual ? 0.5 : 0)) / total)
    const exato = fracao * largura
    const cheios = Math.floor(exato)
    const meio = exato - cheios >= 0.5 && cheios < largura ? '╸' : ''
    const trilho = '─'.repeat(Math.max(0, largura - cheios - meio.length))

    let restante = ''
    if (total > 0 && feitas > 0 && feitas < total && s.etapasInicio !== null) {
      restante = ` · ~${duracao(((agora - s.etapasInicio) / feitas) * (total - feitas))} restantes`
    }
    const etapaAtual = atual ? s.etapas.indexOf(atual) + 1 : Math.min(total, feitas + 1)
    const corte = total > 4 ? 16 : 28

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={cor} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color={cor}>{isAguardando ? '◆' : GIRO[giro % GIRO.length]} </Text>
            <Text backgroundColor={cor} color="inverseText" weight="bold">
              {isAguardando ? ' AGUARDANDO VOCÊ ' : ' TRABALHANDO '}
            </Text>
          </Text>
          <Text dimColor tabular>
            {decorrido === null ? '' : `${duracao(decorrido)} · `}
            {s.acoes} {s.acoes === 1 ? 'ação' : 'ações'}
          </Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color={cor}>{icone} </Text>
            <Text weight={isAguardando ? 'bold' : undefined}>{fazendo}</Text>
          </Text>
          {paralelo ? <Text dimColor>{` ${paralelo}`}</Text> : null}
        </Box>
        {total > 0 ? (
          <Text wrap="truncate-end">
            <Text color={cor}>{'━'.repeat(cheios)}{meio}</Text>
            <Text dimColor>{trilho}</Text>
            <Text weight="bold" tabular>
              {` ${String(Math.round(fracao * 100)).padStart(3)}%`}
            </Text>
            <Text dimColor>
              {'  '}etapa {etapaAtual} de {total}
              {restante}
            </Text>
          </Text>
        ) : (
          <Text dimColor wrap="truncate-end">
            {'─'.repeat(largura)}  sem plano de etapas: progresso indisponível
          </Text>
        )}
        {total > 0 ? (
          <Text wrap="truncate-end">
            {s.etapas.map((x, i) => (
              <Text
                color={x.status === 'feita' ? 'success' : x.status === 'andamento' ? cor : undefined}
                dimColor={x.status === 'pendente'}
                weight={x.status === 'andamento' ? 'bold' : undefined}
              >
                {i > 0 ? '   ' : ''}
                {x.status === 'feita' ? '●' : x.status === 'andamento' ? '◉' : '○'} {encurtar(x.titulo, corte)}
              </Text>
            ))}
          </Text>
        ) : null}
        {fundo.length > 0 ? (
          <Text wrap="truncate-end">
            <Text color="suggestion">⇢ </Text>
            <Text dimColor>
              {fundo.length} em segundo plano: {fundo.map(x => x.rotulo).join(' · ')}
            </Text>
          </Text>
        ) : null}
      </Box>
    )
  })
}
