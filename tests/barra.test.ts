import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const banda = (isWorking: boolean) => ({
  plugin: 'status-sessao',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking,
    maxRows: 10,
    bodyColumns: 90,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
})

function motor(on: On) {
  mock.clock(on, { now: 1_000_000 })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
}

test('sem nenhum turno ainda, a barra não aparece', async ($, on) => {
  motor(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...banda(false), surface })
    expect(await ui.find({ type: 'Text', text: /Pronto|TRABALHANDO/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('trabalhando mostra a fase, o plano e o progresso', async ($, on) => {
  motor(on)
  await $.turn.start({ text: 'faz tudo', turnId: 't1' })
  const chamar = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await chamar({
    tool: 'mcp__status-sessao__progresso',
    tool_use_id: 'u1',
    etapas: [
      { titulo: 'Ler o código', status: 'feita' },
      { titulo: 'Escrever o mod', status: 'andamento' },
      { titulo: 'Testar', status: 'pendente' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...banda(true), surface })
    expect(await ui.find({ type: 'Text', text: /TRABALHANDO/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /etapa 2 de 3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /◉ Escrever o mod/ })).toBeDefined()
    await ui.unmount()
  }
})

test('depois do turno, mostra que está parado', async ($, on) => {
  motor(on)
  await $.turn.start({ text: 'oi', turnId: 't2' })
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: '', durationMs: 0, isAborted: false } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...banda(false), surface })
    expect(await ui.find({ type: 'Text', text: /Pronto, sua vez/ })).toBeDefined()
    await ui.unmount()
  }
})

function motorComFundo(on: On, agentes: unknown[] = []) {
  motor(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('classic.Stop', () => ({}) as never)
  on('agent.list', () => ({ value: agentes }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
  }))
  on('tool.call', { tool: 'Agent' }, () => ({
    result: { status: 'async_launched', agentId: 'a1', description: 'Revisar o código', prompt: 'x', outputFile: 'f' },
  }) as never)
}

async function lancarDois($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.turn.start({ text: 'roda tudo', turnId: 't1' })
  const chamar = $.tool.call as unknown as (input: unknown) => Promise<unknown>
  await chamar({ tool: 'Bash', tool_use_id: 'u1', command: 'npm test', description: 'Rodar os testes', run_in_background: true })
  await chamar({ tool: 'Agent', tool_use_id: 'u2', description: 'Revisar o código', prompt: 'revisa', subagent_type: 'Explore' })
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: '', durationMs: 0, isAborted: false } as never)
}

test('turno encerrado com tarefas em segundo plano não diz "Pronto"', async ($, on) => {
  motorComFundo(on)
  await lancarDois($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...banda(false), surface })
    expect(await ui.find({ type: 'Text', text: /EM SEGUNDO PLANO/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 tarefas ainda rodando/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Rodar os testes/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Revisar o código/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Pronto, sua vez/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('o aviso de fim tira o comando da lista; o fim do subagente leva ao "Pronto"', async ($, on) => {
  motorComFundo(on)
  await lancarDois($)

  const submeter = $.prompt.submit as unknown as (input: unknown) => Promise<unknown>
  await submeter({
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>ok</summary>\n</task-notification>',
    wait: false,
    origin: { kind: 'task-notification' },
  })
  let ui = await $.ui.mount({ ...banda(false), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /1 tarefa ainda rodando/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Rodar os testes/ })).toBeUndefined()
  await ui.unmount()

  await $.turn.start({ text: '', turnId: 'ta', agentId: 'a1' })
  await $.turn.complete({ turnId: 'ta', agentId: 'a1', reason: 'answer', answer: '', durationMs: 0, isAborted: false } as never)
  ui = await $.ui.mount({ ...banda(false), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Pronto, sua vez/ })).toBeDefined()
  await ui.unmount()
})

test('a lista oficial do Stop substitui a do mod', async ($, on) => {
  motorComFundo(on)
  await lancarDois($)
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'Revisar o código' }],
  } as never)

  const ui = await $.ui.mount({ ...banda(false), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /1 tarefa ainda rodando/ })).toBeDefined()
  await ui.unmount()
})

test('trabalhando, a barra mostra o que segue em segundo plano', async ($, on) => {
  motorComFundo(on)
  await lancarDois($)
  await $.turn.start({ text: 'outra coisa', turnId: 't2' })

  const ui = await $.ui.mount({ ...banda(true), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /TRABALHANDO/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 em segundo plano/ })).toBeDefined()
  await ui.unmount()
})

test('turno aberto por um aviso, sem agir, fica na moldura de segundo plano', async ($, on) => {
  motorComFundo(on)
  await lancarDois($)

  const submeter = $.prompt.submit as unknown as (input: unknown) => Promise<unknown>
  await submeter({
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>',
    wait: false,
    origin: { kind: 'task-notification' },
  })
  await $.turn.start({ text: '', turnId: 't3' })

  const ui = await $.ui.mount({ ...banda(true), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /LENDO AVISO/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /TRABALHANDO/ })).toBeUndefined()
  await ui.unmount()
})

test('subagente que encerrou o turno mas espera trabalho próprio continua na lista', async ($, on) => {
  motorComFundo(on, [{ id: 'a1', description: 'Revisar o código', type: 'Explore', status: 'waiting' }])
  await lancarDois($)

  const submeter = $.prompt.submit as unknown as (input: unknown) => Promise<unknown>
  await submeter({
    text: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>Agent "x" is waiting on its own background work</summary>\n</task-notification>',
    wait: false,
    origin: { kind: 'task-notification' },
  })
  await $.turn.start({ text: '', turnId: 'ta', agentId: 'a1' })
  await $.turn.complete({ turnId: 'ta', agentId: 'a1', reason: 'answer', answer: '', durationMs: 0, isAborted: false } as never)

  const ui = await $.ui.mount({ ...banda(false), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /2 tarefas ainda rodando/ })).toBeDefined()
  await ui.unmount()
})
