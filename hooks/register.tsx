import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Ao, Etapa } from '../types'

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
}

const ao = atom({ plugin: 'status-sessao', key: 'ao' } as const, INICIAL)
const pulso = atom({ plugin: 'status-sessao', key: 'pulso' } as const, 0)

const FERRAMENTA = 'progresso'
const FERRAMENTA_COMPLETA = `mcp__status-sessao__${FERRAMENTA}`

const GIRO = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

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

export const register: Register = on => {
  let estaTrabalhando = false

  on('session.start', async ($, e, next) => {
    estaTrabalhando = (await read($, ao)).fase !== 'parado'
    $.clock.every(400, () => {
      if (estaTrabalhando) void update($, pulso, n => n + 1)
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

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const agora = await $.clock.now()
      estaTrabalhando = true
      await update($, ao, (s): Ao => {
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
        }
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const agora = await $.clock.now()
      estaTrabalhando = false
      await update($, ao, (s): Ao => ({
        ...s,
        fase: 'parado',
        aguardandoMotivo: null,
        rodando: [],
        ultimoTurno: {
          segundos: s.inicio === null ? 0 : Math.round((agora - s.inicio) / 1000),
          acoes: s.acoes,
          motivo: e.reason,
        },
      }))
    }

    return next(e)
  })

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
    const rotulo = rotuloDe(e.tool, args)
    const isSubagente = e.agentId !== undefined
    const espera =
      e.tool === 'AskUserQuestion'
        ? 'sua resposta a uma pergunta'
        : String(e.tool) === 'ExitPlanMode'
          ? 'sua aprovação do plano'
          : null

    await update($, ao, s => ({
      ...s,
      acoes: s.acoes + 1,
      rodando: [...s.rodando, { id: e.tool_use_id, rotulo, icone: iconeDe(e.tool), isSubagente }].slice(-20),
      ultimaAtividade: rotulo,
      ...(espera !== null && !isSubagente ? { fase: 'aguardando' as const, aguardandoMotivo: espera } : {}),
    }))

    const ran = await next(e)

    const agora = await $.clock.now()
    const isOk = !('deny' in ran && ran.deny !== undefined) && ran.isError !== true
    await update($, ao, (s): Ao => {
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

      return {
        ...s,
        fase: s.fase === 'parado' ? 'parado' : 'trabalhando',
        aguardandoMotivo: null,
        rodando: s.rodando.filter(x => x.id !== e.tool_use_id),
        etapas,
        etapasInicio: mudouPlano ? (s.etapasInicio ?? agora) : s.etapasInicio,
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

    const total = s.etapas.length
    const feitas = s.etapas.filter(x => x.status === 'feita').length
    const atual = s.etapas.find(x => x.status === 'andamento')

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
              {plano}
            </Text>
          </Text>
        </Box>
      )
    }

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
      </Box>
    )
  })
}
