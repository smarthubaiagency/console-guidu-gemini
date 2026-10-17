# Integração com o Google: app OAuth (CF6b)

Guia de operação do app OAuth do Google usado pelos workspaces para conectar a conta Google (Drive, Planilhas e Agenda). Decisão do Marcelo (14/10/2026): o app é da GUIDU por padrão, com uma verificação só no Google; o parceiro pode cadastrar o próprio app para o consentimento mostrar a marca dele. Plano em [plano-cf6b.md](../configuracoes/plano-cf6b.md).

Nenhum segredo vai para o repositório: o Client Secret é digitado na tela, cifrado com o `ENCRYPTION_KEY` e mostrado depois só mascarado.

## 1. Criar o app no Google Cloud

1. No projeto do Google Cloud da GUIDU (ou do parceiro), ative as APIs que serão usadas: Google Drive API, Google Sheets API e Google Calendar API.
2. Em **Tela de consentimento OAuth**: tipo externo, nome e logo da marca, e-mail de suporte, domínio autorizado (o do `APP_URL`), links de privacidade e termos.
3. Escopos pedidos pela GUIDU: `openid`, `email`, `.../auth/drive.file`, `.../auth/spreadsheets` e `.../auth/calendar.events`. Os dois últimos são sensíveis: sem a verificação do Google, só as contas de teste cadastradas no app conseguem conectar.
4. Em **Credenciais › Criar ID do cliente OAuth**: tipo "Aplicativo da Web"; em "URIs de redirecionamento autorizados", cole a **URL de retorno** mostrada na tela da GUIDU (é o `APP_URL` mais `/api/integrations/google/callback`). Ela é a mesma para o app da GUIDU e para o app de qualquer parceiro: o fluxo volta depois ao domínio onde a pessoa começou.
5. Copie o Client ID e o Client Secret.

## 2. Cadastrar na GUIDU

- **Plataforma** (owner ou operations): Configurações › API e integrações › **Google**. Informe Client ID, Client Secret e a situação da verificação (em teste, em produção sem verificação, em análise, verificado). Para trocar só a situação, deixe o segredo em branco. No mesmo lugar, os **escopos liberados** para os workspaces.
- **Parceiro** (owner ou admin): Configurações › Integrações › **Google**. O app próprio é opcional; sem ele, os clientes usam o da GUIDU. O parceiro também pode desligar escopos para os clientes dele (nunca ligar o que a plataforma desligou). Remover o app próprio devolve os clientes ao app da GUIDU, e as conexões feitas com o app do parceiro precisam ser refeitas.
- **Workspace** (owner ou admin): Configurações › Canais e integrações › **Integrações** › Conectar conta Google. A página mostra a conta, o app usado e os escopos autorizados; "Desconectar" apaga a conexão e revoga o token no Google. Na limpeza final de um workspace excluído, o gancho `core.google_connection` revoga o token antes de apagar a conexão; um token já inválido conta como revogado ([exclusao-suave-workspace.md](exclusao-suave-workspace.md)).

## 3. Verificação do Google

Pedido feito pelo dono do app no Google Cloud (tela de consentimento › Publicar app › Preparar para verificação). O Google pede vídeo do uso dos escopos, política de privacidade publicada e justificativa de cada escopo sensível. Enquanto isso, registre "Verificação em análise" na tela; ao concluir, "Verificado".

## 4. Testes e ambiente

- `GOOGLE_OAUTH_PROVIDER=fake` liga o Google falso (testes e e2e): o consentimento responde na hora e nada sai do processo. Produção recusa subir com ele.
- O fluxo usa `APP_URL` para a URL de retorno; sem ele, o botão de conectar fica desabilitado.
- As ferramentas que usam a conta (planilha, agenda, Drive nos GUIDS) e a renovação do token de acesso com o refresh token ficam para a G1 ([plano-g1.md](plano-g1.md)).
