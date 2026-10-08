# Pendências abertas

Atualizado em 08/10/2026 a partir da seção 26 da Especificação v1.0, das decisões D1–D8 e dos resultados dos spikes. Itens resolvidos não aparecem como pendência.

| Pendência | Estado / próximo responsável |
| --- | --- |
| Herança de acesso empresarial | Proposta de concessão explícita; produto confirma. |
| Planos, preços e cotas | Comercial define números, política de vagas e limites. |
| Escopo de dados sensíveis | Produto e avaliação jurídica definem. |
| Infraestrutura e recuperação | Operação valida RPO/RTO e cobertura de backup. |
| Prisma com RLS no Supavisor | Validação parcial na SMA-92: incluir `pgbouncer=true` na URL 6543 e repetir reuso, rollback, concorrência e overhead; Data API HTTP também segue pendente. |
| OAuth do MCP | Spike SMA-93 concluído (`docs/spikes/mcp-oauth.md`): Supabase + complemento. Restam decisões do Marcelo — manter ou não o DCR aberto em produção, Site URL e URIs canônicas das duas superfícies, e bind da publishable key do `guidu` para provar a perna de consentimento. Em F4, trocar a verificação JWS do spike por `jose`. |
| Clientes e ferramentas MCP | Começar com núcleo e clientes aprovados; catálogo definitivo continua aberto. |
| Provedores e cobrança | Selecionar com contratos e requisitos de privacidade. |
| Retenção e privacidade | Definir por categoria com responsabilidades. |
| Configurações dos módulos | Catálogo, Google Business e Agentes de IA permanecem abertos em documentos próprios; não inferir regras internas. |
| Escala horizontal de jobs | Certificar `groupConcurrency` do pg-boss entre múltiplos processos antes do primeiro scale-out. |

