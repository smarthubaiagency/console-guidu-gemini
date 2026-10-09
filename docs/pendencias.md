# Pendências abertas

Atualizado em 08/10/2026 a partir da seção 26 da Especificação v1.0, das decisões D1–D9 e dos resultados dos spikes. Itens resolvidos não aparecem como pendência; ficam registrados em "Resolvidas" no fim do arquivo.

| Pendência | Estado / próximo responsável |
| --- | --- |
| Herança de acesso empresarial | Proposta de concessão explícita; produto confirma. |
| Planos, preços e cotas | Comercial define números, política de vagas e limites. Nota: organizations.max_seats usa default técnico 5 até o Comercial definir; não é regra comercial. |
| Escopo de dados sensíveis | Produto e avaliação jurídica definem. |
| Infraestrutura e recuperação | Operação valida RPO/RTO e cobertura de backup. |
| Herança de variáveis de ambiente do Paperclip | Revisar a herança de variáveis de ambiente do Paperclip para os agentes (exposição do banco de controle). |
| Clientes e ferramentas MCP | Começar com núcleo e clientes aprovados; catálogo definitivo continua aberto. |
| Provedores e cobrança | Selecionar com contratos e requisitos de privacidade. |
| Retenção e privacidade | Definir por categoria com responsabilidades. |
| Configurações dos módulos | Catálogo, Google Business e Agentes de IA permanecem abertos em documentos próprios; não inferir regras internas. Módulo Agentes de IA congelado atrás de flag (C04) — ver [ESTADO.md](modules/ai-agents/ESTADO.md). |
| Escala horizontal de jobs | Certificar `groupConcurrency` do pg-boss entre múltiplos processos antes do primeiro scale-out. |
| Auditoria transacional de MFA (`auth.mfa_enrolled`, `auth.mfa_unenrolled`) | Supabase Auth gerencia fatores TOTP via API GoTrue (schema `auth`) fora da transação Postgres/Prisma da aplicação. Sem contexto transacional compartilhado entre GoTrue e Prisma, a gravação de auditoria atômica deve ser vinculada via webhook do Supabase Auth ou trigger em `auth.mfa_factors` na F3 (C11). |

## Resolvidas

| Pendência | Resolução |
| --- | --- |
| Prisma com RLS no Supavisor | Resolvida: validação técnica concluída (SMA-92, revisão SMA-108, validação independente SMA-111 com 11/11 no Supavisor 6543 e no Session pooler 5432, CI local verde na SMA-113). Ver [ADR 0001](adr/0001-prisma-como-caminho-unico.md). |
| OAuth do MCP | Resolvida por D9: a autenticação do MCP passa a usar chaves de API da plataforma e o Supabase OAuth Server é descartado como emissor. Ver [ADR 0009](adr/0009-autenticacao-mcp-chaves-api.md). |
| Vínculo de destinatário e e-mail em convites | Resolvida (C09): convites vinculados estritamente ao e-mail do destinatário autenticado com verificação de `email_confirmed_at` e rota `/invite/[token]`. |
| Chaves de API e escopos MCP para Assistentes | Resolvida (C12): chaves canônicas `gdu_live_` com catálogo Zod de escopos conforme Especificação §17.3, opt-in obrigatório em `proposals:write`, UI em `/settings/mcp` e lookup seguro via `private.resolve_api_key`. |

