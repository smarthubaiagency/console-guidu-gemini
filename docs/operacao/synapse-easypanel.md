# Synapse de desenvolvimento no EasyPanel

Guia para o Marcelo instalar o Synapse de **dev** do Inbox ([ADR 0023](../adr/0023-chat-interno-como-cliente-matrix.md), [plano](../modules/inbox/plano.md)). A instalação de produção vem depois, na F6c, com os mesmos ajustes e backup.

## 1. Antes de instalar: o domínio

O `server_name` é o domínio que aparece no endereço de cada usuário (`@ana:dominio`). **Ele não pode ser trocado depois:** mudar o domínio exige apagar o banco e recomeçar.

- **Dev, recomendado:** `dev.guidu.chat`, servido no mesmo endereço (`https://dev.guidu.chat`). Assim não precisa de `.well-known`.
- **Produção, depois:** `guidu.chat` (domínio já reservado), com o servidor em `matrix.guidu.chat` e os arquivos `.well-known/matrix/client` e `.well-known/matrix/server` na raiz de `guidu.chat` apontando para ele.

## 2. Instalação pelo template

1. Crie um projeto no EasyPanel, por exemplo `guidu-matrix-dev`.
2. Adicione um serviço **Postgres** (`synapse-db`). O Synapse precisa de Postgres; não use SQLite, mesmo que o template ofereça. O banco precisa ser criado com `ENCODING 'UTF8'`, `LC_COLLATE='C'` e `LC_CTYPE='C'`. Se o template não fizer isso, rode no console do Postgres:

   ```sql
   CREATE DATABASE synapse
     ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0;
   ```

3. Adicione o app **Synapse** pelo template, na versão estável mais recente. Anote a versão.
4. No domínio do app, aponte `dev.guidu.chat` para a **porta 8008**, com HTTPS do EasyPanel. **Não exponha a porta 8448** (federação).
5. Garanta um volume persistente em `/data`. É onde ficam o `homeserver.yaml`, as chaves de assinatura e a mídia (`/data/media_store`).

## 3. Ajustes no `/data/homeserver.yaml`

Troque ou acrescente estes blocos. O que estiver entre `<>` você preenche.

```yaml
server_name: "dev.guidu.chat"
public_baseurl: "https://dev.guidu.chat/"
report_stats: false

listeners:
  - port: 8008
    tls: false
    type: http
    x_forwarded: true
    resources:
      - names: [client] # sem "federation": servidor fechado
        compress: false

database:
  name: psycopg2
  args:
    user: <usuário do Postgres>
    password: <senha do Postgres>
    database: synapse
    host: <nome interno do serviço synapse-db>
    cp_min: 5
    cp_max: 10

# Servidor fechado: sem federação e sem cadastro aberto.
federation_domain_whitelist: []
allow_public_rooms_over_federation: false
allow_public_rooms_without_auth: false
enable_registration: false
registration_shared_secret: "<segredo longo gerado por você>"

# Sem criptografia de ponta a ponta (decisão de 16/10/2026). O núcleo
# também trava isso nas salas que ele cria.
encryption_enabled_by_default_for_room_type: "off"

# Login dos atendentes pelo console (o atendente nunca vê senha Matrix).
jwt_config:
  enabled: true
  secret: "<outro segredo longo, só para o JWT>"
  algorithm: "HS256"
  subject_claim: "sub"
  issuer: "guidu-console-dev"
  audiences: ["guidu-matrix-dev"]

# Mídia e prévias.
max_upload_size: 50M
url_preview_enabled: false

# O Application Service do GUIDU entra aqui na etapa IN3; eu mando o arquivo.
app_service_config_files: []
```

Reinicie o app depois de salvar.

Os segredos (`registration_shared_secret`, `jwt_config.secret` e a senha do Postgres) ficam **só no EasyPanel e no seu cofre de senhas**. Não cole nenhum deles aqui no chat. Quando o console precisar do segredo do JWT, ele entra numa variável de ambiente.

## 4. Usuário administrador

No terminal do app Synapse, no EasyPanel:

```sh
register_new_matrix_user -c /data/homeserver.yaml -a -u guidu-admin http://localhost:8008
```

Escolha uma senha forte e guarde no cofre. O núcleo do console vai usar essa conta para criar as contas dos atendentes.

## 5. Conferência

1. `https://dev.guidu.chat/_matrix/client/versions` responde um JSON com a lista de versões.
2. `https://dev.guidu.chat/health` responde `OK`.
3. No Element (app.element.io), em "Entrar", troque o servidor para `https://dev.guidu.chat` e entre com `guidu-admin`. Crie uma sala e mande uma mensagem.
4. Em "Entrar", a opção "Criar conta" não deve aparecer, porque o cadastro está fechado.

## 6. Backup

Ligue o backup do serviço Postgres no EasyPanel e inclua o volume `/data`. A mídia não fica no banco, fica em `/data/media_store`. Em dev pode ser diário. Na produção, a F6c define o resto.

## 7. O que informar no chat

- o `server_name` e o endereço usados;
- a versão do Synapse;
- o resultado dos 4 passos da seção 5;
- a confirmação de que os segredos estão guardados (sem os valores).

A conexão do console com esse servidor só começa na IN3. A prova de conceito (IN1) roda num Synapse local, então não precisa esperar esta instalação.
