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
  await $.turn.complete({ turnId: 't2', reason: 'answer' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...banda(false), surface })
    expect(await ui.find({ type: 'Text', text: /Pronto, sua vez/ })).toBeDefined()
    await ui.unmount()
  }
})
