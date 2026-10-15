# Segurança: MFA por área, lista de IPs e eventos

Etapa CF5a do plano das configurações (`/mnt/project-files/configuracoes/plano-cf5.md`). Telas em Configurações › Segurança na /platform, no /admin e no /app.

## MFA por área

| Área      | Regra                                                                                     |
| --------- | ----------------------------------------------------------------------------------------- |
| /platform | Sempre exigida (código).                                                                  |
| /admin    | Sempre exigida (código).                                                                  |
| /app      | Chave `security.mfa.app` da cascata: plataforma, parceiro (para os clientes) e workspace. |

A chave só aperta: se um nível de cima exige, os de baixo não desligam. Quem entra num workspace que exige MFA sem o segundo fator vai para `/auth/mfa`; sem fator, para `/app/account/security`, fora do workspace, onde ativa. A checagem fica em `resolveRequestWorkspaceContext`. Chaves de API e MCP não passam por ela.

## Lista de IPs

Opcional, uma para a /platform e uma por parceiro para o /admin dele (tabela `ip_allowlists`). Sem lista, qualquer endereço entra. Com lista, só os endereços dela; sem endereço legível, ninguém entra.

- Vale para páginas e ações da área: os guardas de papel (`getPlatformAdminMember`, `getPartnerMembership`, `requirePlatformAdminPage`, `requirePartnerConsolePage`, `platformActor`, `partnerActor`) consultam `private.ip_allowed`.
- Não vale para chaves de API da plataforma nem para o worker.
- O servidor recusa salvar uma lista que não inclua o endereço de quem salva.

### Como o endereço é lido

O endereço vem do `X-Forwarded-For`, contando da direita:

- **Só Traefik na frente** (padrão, `TRUSTED_PROXY_HOPS=1`): o Traefik descarta o `X-Forwarded-For` de quem não é confiável e acrescenta o endereço de quem conectou. O último item é o visitante.
- **Cloudflare (proxy laranja) na frente do Traefik:** configure no entrypoint do Traefik `forwardedHeaders.trustedIPs` com as faixas do Cloudflare e use `TRUSTED_PROXY_HOPS=2`. Sem o `trustedIPs`, o Traefik descarta o cabeçalho do Cloudflare e todo visitante parece ser um IP do Cloudflare: não ligue a lista nesse caso.
- Sem proxy (desenvolvimento), o próprio Next.js preenche o cabeçalho com o endereço do socket.

Confira na tela: o card mostra "Seu endereço agora". Se aparecer um IP do Cloudflare ou da rede interna do Docker, a contagem de saltos está errada.

### Recuperação

Se uma lista trancar todo mundo (endereço mudou, proxy reconfigurado):

1. Emergência sem banco: `SECURITY_IP_ALLOWLIST=off` no ambiente do serviço web e reinício. A checagem para em todas as áreas. Retire depois de corrigir a lista.
2. Pelo banco, como operador com aprovação: `delete from public.ip_allowlists where area = 'platform';` (ou `where partner_id = '<id>'`).

## Eventos de segurança

Leitura de `audit_events` por `private.security_events`: logins (`auth.sign_in`), segundo fator (`auth.mfa_verified`, `auth.mfa_failed`, `auth.mfa_enrolled`, `auth.mfa_unenrolled`), chaves e credenciais, papéis e membros, convites, acesso de suporte e mudanças de segurança. A plataforma (owner, operations, support) vê tudo; o parceiro (owner, admin) vê os eventos com o id dele e os das empresas dos clientes. Tentativas de login com senha errada ficam só nos logs do Supabase Auth.

## Senha e sessão

Moram no Supabase Auth do projeto. A tela só informa; mudar exige aprovação do Marcelo, porque mexe no Auth.

## Variáveis

| Variável                | Padrão | Uso                                                        |
| ----------------------- | ------ | ---------------------------------------------------------- |
| `TRUSTED_PROXY_HOPS`    | `1`    | Quantos proxies confiáveis acrescentam ao X-Forwarded-For. |
| `SECURITY_IP_ALLOWLIST` | vazio  | `off` desliga a checagem das listas (emergência).          |
