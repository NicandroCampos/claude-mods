# status-sessao

Mod para o Claude Code que mostra, acima do campo de mensagem, uma barra com o estado da sessão:

- se o Claude está **trabalhando**, **aguardando você** (pergunta, aprovação de plano ou permissão) ou **parado**;
- há quanto tempo está trabalhando e quantas ações já fez;
- o que está fazendo agora ("Lendo arquivo.ts", "Rodando comando: …", "Pesquisando na web…");
- o progresso do plano de etapas, com porcentagem, etapa atual, próxima etapa e tempo restante estimado.

```
╭──────────────────────────────────────────────────────────────────╮
│ ⠹  TRABALHANDO                                   2m 14s · 12 ações │
│ ✎ Editando register.tsx                            +1 em paralelo │
│ ━━━━━━━━━━━━━━━━━━━━╸───────────────   58%  etapa 3 de 5 · ~1m 40s │
│ ● Ler código   ● Escrever mod   ◉ Testes   ○ Revisar   ○ Publicar  │
╰──────────────────────────────────────────────────────────────────╯
```

A moldura muda de cor com a fase: laranja trabalhando, amarela aguardando você. Parado, a barra encolhe para uma linha: `✓ Pronto, sua vez  último trabalho: 3m 02s · 18 ações`.

O progresso vem de uma ferramenta que o mod registra (`progresso`): em pedidos de 3 ou mais etapas, o Claude declara o plano e atualiza a cada etapa. Também lê as listas de tarefas nativas (TodoWrite, TaskCreate/TaskUpdate). Sem plano, a barra diz que o progresso está indisponível em vez de inventar um número.

## Instalar

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install status-sessao --marketplace NicandroCampos/claude-mods
```

Responda `y` para adicionar o marketplace e escolha o escopo (usuário, o primeiro da lista, vale para todas as sessões).

Pelo shell:

```bash
claude plugin install status-sessao --marketplace NicandroCampos/claude-mods
```

No app desktop, onde `/plugin` não roda: clique em **+** ao lado da caixa de mensagem, depois **Plugins**, **Add marketplace** com `NicandroCampos/claude-mods`, e então **Add plugin**.
