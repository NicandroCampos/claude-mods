export type Etapa = { id: string; titulo: string; status: 'pendente' | 'andamento' | 'feita' }

export type Atividade = { id: string; rotulo: string; isSubagente: boolean }

export type Ao = {
  fase: 'parado' | 'trabalhando' | 'aguardando'
  inicio: number | null
  aguardandoMotivo: string | null
  acoes: number
  rodando: Atividade[]
  ultimaAtividade: string | null
  etapas: Etapa[]
  etapasInicio: number | null
  ultimoTurno: { segundos: number; acoes: number; motivo: string } | null
}

declare module 'claude-code' {
  interface PluginState {
    'status-sessao': { ao: Ao; pulso: number }
  }
}
