# Plano U2b + U3: telas no padrão shadcn e edição na gaveta

Base: ADR 0014 (revisão de 12/10/2026, regra "todo componente segue o shadcn") e ADR 0015 (gaveta interna aceita).

## Onde estamos

Inventário em `src/` fora de `src/components/ui/` (12/10/2026):

| Elemento feito à mão | Arquivos | Usos |
| -------------------- | -------- | ---- |
| `<input>`            | 44       | 226  |
| `<label>`            | 33       | 180  |
| `<button>`           | 20       | 55   |
| `<select>`           | 19       | 37   |
| `<textarea>`         | 10       | 20   |
| `<table>`            | 9        | 10   |

Também há um kit próprio em `src/shared/ui/form.tsx` (usado em 23 arquivos) e breadcrumbs repetidos dentro de páginas do `/admin` e do `/platform`, que agora ficam só no cabeçalho do shell.

## Etapas (uma de cada vez, um PR cada)

### U2b: edição na gaveta e breadcrumb único

- CRM (contatos), Portfólio e Hello World: editar abre no `WorkbenchLayout` com URL `?edit=<id>`, em vez de página ou formulário solto.
- Tirar os breadcrumbs de dentro das páginas; cada página começa pelo `h1`.
- e2e de CRM, Portfólio e Hello World ajustados.

### U3a: base de componentes

- Vendorizar do registro oficial: `label`, `textarea`, `select`, `checkbox`, `switch`, `radio-group`, `table`, `card`, `badge`, `alert`, `tabs` e `sonner` (avisos).
- Refazer `src/shared/ui/form.tsx` por cima deles, mantendo a mesma API: as 23 telas que usam o kit mudam de visual sem mexer no código delas.
- Página `/platform/design/componentes` como catálogo, ao lado da gaveta.

### U3b: telas do `/app`

- Configurações (geral, equipe, cobrança, credenciais, MCP, locais, dados, suporte), execuções, propostas, conta.

### U3c: telas do `/admin` e do `/platform`

- Clientes, workspaces, usuários, parceiros, cobrança, idiomas, chaves de API, módulos, marca e jurídico.

### U3d: telas fora do shell e módulos

- Login, MFA, convites e o `auth-shell`; componentes dos módulos (CRM, Portfólio, Hello World).

### U3e: trava no lint

- Regra ESLint que proíbe `<button>`, `<input>`, `<select>`, `<textarea>` e `<table>` crus fora de `src/components/ui/`, para a regra não se perder.

## Fora do escopo

- Mudar regras de negócio, rotas ou permissões.
- Trocar o design system (tokens GUIDU continuam a fonte das cores).

## Depois

F6a (revisão de segurança), como combinado.
