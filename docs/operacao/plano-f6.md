# Plano da F6 — Produção

A F6 é a última fase da [ADR 0003](../adr/0003-ordem-das-fases.md). Pela especificação (§23), a condição de saída é: revisão de segurança, testes críticos, restore, procedimentos e liberação controlada. Entram também o que as fases anteriores deixaram para a F6:

- a prova real de restore (AC13), conforme [backup-restore.md](backup-restore.md);
- a configuração dos alertas no provedor, conforme [observabilidade.md](observabilidade.md);
- a P7: subdomínios, domínio próprio e e-mail por marca ([plano de parceiros](../partners/plano-de-execucao.md)).

## Situação ao abrir a F6 (11/10/2026)

| Fase                                             | Estado                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| F0 Decisões, F1 Fundação, F2 Dashboard e módulos | Concluídas                                                                                   |
| F3 Operação                                      | Concluída ([plano-f3.md](plano-f3.md))                                                       |
| F4 API REST e MCP                                | Concluída ([plano-f4.md](plano-f4.md))                                                       |
| F5 Portfólio                                     | F5a a F5d concluídas; a F5e (mídia) espera a escolha do Storage ([plano-f5.md](plano-f5.md)) |

Fora da sequência das fases:

- **P6**, a cobrança real pela Iugu: espera a conta e as decisões D-PA-03, D-PA-04, D-PA-05 e D-PA-07.
- **Módulo Agentes de IA:** congelado, aguardando a especificação.

## Etapas

| Etapa    | Entrega                                  | Depende de                                                   |
| -------- | ---------------------------------------- | ------------------------------------------------------------ |
| F6a      | Revisão de segurança                     | Nada; pode começar                                           |
| F6b      | Testes críticos                          | Nada; pode começar                                           |
| F6c      | Ambiente de produção                     | Aprovação do Marcelo para criar e operar produção, e acessos |
| F6d      | Restore real e procedimentos             | F6c                                                          |
| F6e (P7) | Domínios por parceiro e e-mail por marca | F6c e o provedor de e-mail (D-PA-08)                         |
| F6f      | Liberação controlada                     | F6c a F6e e a escolha dos pilotos                            |

### F6a — Revisão de segurança

- Cabeçalhos HTTP e política de conteúdo (CSP), cookies e proteção contra CSRF nas escritas por sessão.
- Segredos: nenhum no repositório, nos logs ou nas mensagens de erro; variáveis obrigatórias conferidas na subida.
- Dependências: auditoria de vulnerabilidades e versões fixadas.
- RLS e permissões revisadas de ponta a ponta: cada tabela com FORCE RLS, políticas por papel e funções SECURITY DEFINER com o dono certo.
- API e MCP: escopos, limites de requisição, origem do MCP e revalidação das chaves.
- Entrega: relatório em `docs/auditoria/` e as correções em PRs próprios.

### F6b — Testes críticos

- Matriz dos critérios de aceite da especificação (§24, AC01 em diante), cada um com teste e evidência no CI.
- Lacunas viram testes novos.
- Teste de carga básico da API e do MCP, com os limites medidos registrados.

### F6c — Ambiente de produção

- Projeto Supabase de produção e deploy no Coolify (web, worker e Redis).
- As migrations entram em produção pelo mesmo `scripts/migrate.ts`, só com aprovação do Marcelo registrada no PR. A ADR 0010 continua valendo para o dev.
- Variáveis e segredos no provedor, os alertas recomendados configurados e a exportação de logs ligada.
- Requer uma ADR de produção (hospedagem, região, papéis do banco, quem aplica migrations).

### F6d — Restore real e procedimentos

- Prova de restore do banco (e do Storage, quando a F5e entrar) no objetivo declarado, com a reaplicação de exclusões e revogações (AC13).
- Procedimentos de operação: incidentes, rotação de chaves e segredos, suporte, publicação de versões e rollback.

### F6e — Domínios e e-mail por marca (P7)

- Subdomínios e domínio próprio do parceiro, com prova de posse por TXT e certificado automático.
- E-mail por marca, conforme a P7 do plano de parceiros.

### F6f — Liberação controlada

- Piloto com poucos clientes escolhidos pelo Marcelo, com critérios de abertura e de recuo.
- Acompanhamento pelos sinais da F3d durante o piloto.

## Decisões pendentes do Marcelo

1. Storage da mídia (Supabase ou Cloudflare R2), para a F5e.
2. Provedor de e-mail (D-PA-08), para a P7.
3. Aprovação para criar e operar o ambiente de produção, para a F6c.
4. Clientes do piloto, para a F6f.
