# Discord Clone — Software Desktop em Tempo Real

Aplicativo desktop completo inspirado no Discord, construído com **Electron**, **React**, **TypeScript**, **Tailwind CSS**, **Node.js/Express**, **Socket.io**, **Prisma (SQLite)** e **LiveKit** para voz, vídeo e compartilhamento de telas.

---

## ✨ Funcionalidades Principais

- 🎮 **Interface Idêntica ao Discord**: Tema escuro autêntico (`#1e1f22`, `#2b2d31`, `#313338`, `#5865F2`), barra lateral de servidores com formato circular arredondado e indicador de servidor ativo.
- 💬 **Canais de Texto & Chat em Tempo Real**: Envio e recepção de mensagens instantâneas via WebSockets (Socket.io), histórico persistido no SQLite via Prisma ORM, exibição de avatares e horários.
- 🔊 **Canais de Voz**: Conexão com canais de voz com baixa latência, indicador luminoso de fala (anel verde animado quando o participante fala), controle de microfone mudo/desativar mudo e ensordecer.
- 🖥️ **Compartilhamento de Tela & Janelas**: Seletor nativo do Electron com miniaturas das janelas e telas disponíveis via `desktopCapturer`, transmissão com visualizador em destaque (spotlight) ou grade lado a lado.
- 🏢 **Criação e Gestão de Servidores**: Criação de servidores com geração automática de canais `#geral` e `🔊 Geral`, além de criação dinâmica de canais adicionais de texto e voz.
- 👥 **Autenticação Flexível**: Registro com senha e login seguro via JWT, com botões de atalho de **Login Rápido para Testes** (Alice e Bob) para testar múltiplas janelas no mesmo computador com um clique.

---

## 🚀 Como Executar

### 1. Iniciar Tudo com um Único Comando
Na raiz do projeto, execute:
```bash
npm run dev
```
Isso iniciará simultaneamente:
- O backend Node.js / Express na porta `3001`
- O cliente Desktop Electron + Vite React

### 2. Executar Separadamente (Opcional)
Se preferir rodar em terminais separados:
- **Backend**:
  ```bash
  npm run server:dev
  ```
- **Cliente Desktop**:
  ```bash
  npm run client:dev
  ```

---

## 📡 Configuração do LiveKit (Opcional para Chamadas Remotas)

O software já conta com simulação local nativa de captura de tela, câmera e microfone. Para conectar múltiplos computadores remotos com qualidade profissional de estúdio (SFU):
1. Crie uma conta gratuita em [livekit.io](https://cloud.livekit.io).
2. Crie um projeto novo e copie suas credenciais.
3. No arquivo `server/.env`, preencha:
   ```env
   LIVEKIT_URL=wss://seu-projeto.livekit.cloud
   LIVEKIT_API_KEY=sua_api_key
   LIVEKIT_API_SECRET=seu_api_secret
   ```
4. Reinicie o servidor (`npm run server:dev`).

---

## 📂 Estrutura do Projeto

```
a/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma       # Modelos User, Server, Channel, Message, Member
│   │   └── dev.db              # Banco de dados SQLite local
│   ├── src/
│   │   ├── index.ts            # Servidor Express + Socket.io
│   │   ├── routes/             # Rotas de auth, servers, channels e livekit
│   │   ├── middlewares/        # Middleware de proteção JWT
│   │   ├── sockets/            # Handlers de chat em tempo real
│   │   └── lib/                # Prisma e gerador de AccessToken LiveKit
│   └── .env
└── client/
    ├── electron/
    │   ├── main.ts             # Processo principal Electron (janela + desktopCapturer)
    │   └── preload.ts          # IPC Bridge seguro para telas/janelas
    └── src/
        ├── contexts/           # AuthContext, SocketContext, VoiceContext
        ├── components/
        │   ├── layout/         # ServerSidebar, ChannelSidebar, MemberList, Footer
        │   ├── chat/           # MessageArea, ChatInput, MessageItem, Header
        │   ├── voice/          # VoiceRoom, ParticipantTile, ScreenShareModal
        │   └── modals/         # CreateServerModal, CreateChannelModal, AuthModal
        └── lib/                # Axios API e utilitários
```
