# Diligências Magalhães

Sistema web para acompanhamento e registro de diligências jurídicas, criado para substituir a operação diária direta na aba **Planilha Geral** sem abandonar a planilha como fonte de compatibilidade.

## O que já existe no MVP

- Dashboard com processos ativos, itens para hoje, registros sem atualização e pendências de orientação.
- Busca por processo, cliente, parte, comarca, vara, status e solicitação.
- Filtros de status e prioridade.
- Cadastro e edição de diligências refletindo na aba `Planilha Geral`.
- Campos extras: prioridade, próxima ação e próxima verificação.
- Histórico cronológico em aba auxiliar `Sistema_Historico`.
- Estrutura para tarefas em `Sistema_Tarefas`.
- Atalho para o portal oficial do tribunal; o número CNJ é copiado ao abrir.
- Modo demonstração automático caso a integração ainda não esteja configurada.
- Cloudflare Pages Function como proxy, mantendo o segredo do Apps Script fora do navegador.
- Layout responsivo para computador e celular.

## Arquitetura

```
Navegador
   ↓
Cloudflare Pages
   ↓ /api/sheets
Pages Function
   ↓ segredo armazenado no Cloudflare
Google Apps Script
   ↓
Google Sheets / Planilha Geral
```

O navegador **não recebe credenciais Google e não recebe o segredo do Apps Script**.

## 1. Criar o Apps Script na planilha

1. Abra a planilha que contém a aba `Planilha Geral`.
2. Vá em **Extensões → Apps Script**.
3. Apague o conteúdo de `Code.gs`.
4. Cole o conteúdo de `apps-script/Code.gs` deste repositório.
5. Em **Configurações do projeto → Propriedades do script**, crie:
   - chave: `API_SECRET`
   - valor: uma senha longa aleatória (ex.: 40+ caracteres)
6. Em **Implantar → Nova implantação → Aplicativo da Web**:
   - Executar como: **você**
   - Quem pode acessar: **Qualquer pessoa**
7. Autorize o acesso à planilha e copie a URL terminada em `/exec`.

> O endpoint é público, porém toda leitura/escrita exige o `API_SECRET`, que fica apenas no Cloudflare Pages.

## 2. Cloudflare Pages

Crie/importa o projeto a partir deste repositório.

Configuração de build:

- Framework preset: **None**
- Build command: **deixe vazio**
- Build output directory: `/` (raiz do projeto)

O frontend é estático e não depende de Node/Vite para publicar.

Em **Settings → Variables and Secrets**, crie como secrets:

- `APPS_SCRIPT_URL` = URL `/exec` da implantação do Apps Script
- `APPS_SCRIPT_SECRET` = o mesmo valor configurado em `API_SECRET`

Depois faça um novo deploy.

## 3. Estrutura esperada da Planilha Geral

As 12 primeiras colunas são mantidas conforme o arquivo original:

A Responsável / origem  
B Nº do processo  
C Cliente  
D Adverso  
E Comarca  
F Vara  
G Seção  
H Solicitação  
I Data da Solicitação  
J Status  
K OBS  
L Atualizado em

O sistema usa três colunas adicionais, sem alterar as anteriores:

M Prioridade  
N Próxima ação  
O Próxima verificação

Na primeira gravação, o Apps Script preenche esses cabeçalhos se estiverem vazios.

## Segurança

- Nunca coloque `APPS_SCRIPT_SECRET` em arquivos do frontend, `.env` versionado ou JavaScript servido ao navegador.
- Recomenda-se repositório privado por se tratar de um sistema jurídico, ainda que dados reais não sejam versionados.
- Dados reais são carregados em tempo de execução; este repositório contém apenas registros de demonstração fictícios/derivados para interface.

## Desenvolvimento local

```bash
python -m http.server 8000
```

Acesse `http://localhost:8000`. Sem variáveis do Cloudflare/Pages Functions, o frontend entra automaticamente em **modo demonstração**.
