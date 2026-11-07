# Regras e Diretrizes do Projeto Xolas

## Diretrizes de Interface e Layout
- **Aba de Atualizações Sempre por Último**: Em qualquer menu, barra de navegação ou modal de configurações (`SettingsModal`) onde a opção/aba de **Atualizações** estiver presente, ela deve permanecer **obrigatoriamente como o último item da lista** (à direita/no fim de todas as outras opções), garantindo consistência visual e previsibilidade de navegação.

## Fluxo de Desenvolvimento: Revisão e Refatoração com Subagente
Sempre que implementar uma **nova funcionalidade** ou **correção de bug**, antes de iniciar o ciclo de finalização:
1. **Invocação do Subagente de Revisão e Refatoração**:
   - Lançar um subagente (`Role: 'Code Reviewer & Refactorer'`) encarregado de auditar o diff recém-produzido.
2. **Escopo de Atuação do Subagente**:
   - **Refatoração Ativa**: Eliminar código morto/duplicado, otimizar tipagens TypeScript e aplicar boas práticas de clean code.
   - **Engenharia Defensiva**: Checar vazamentos de memória, cancelamento de listeners em desmontagens (`useEffect`), fechamento adequado de pipelines de áudio/WebRTC e encerramento de processos auxiliares nativos.
   - **Conformidade de Diretrizes**: Verificar aderência estrita às regras do projeto (ex: posicionamento de abas, convenções de layout Obsidian).
3. **Feedback Estruturado**:
   - O subagente entrega um resumo objetivo com as melhorias aplicadas e riscos prevenidos antes do build.

## Ciclo de Finalização de Tarefas (Obrigatório)
Sempre que finalizar qualquer tarefa, modificação ou correção no projeto:
1. **Incremento de Versão**: Incrementar o patch version em `package.json` e `client/package.json` (ex: `1.0.24` -> `1.0.25`).
2. **Validação de Build**: Executar `npm --prefix client run build` para garantir que o TypeScript e o Vite compilam sem nenhum erro.
3. **Commit no Git**: Adicionar os arquivos modificados e criar o commit com mensagem clara e padronizada (Conventional Commits, ex: `feat(...)`, `fix(...)`).
4. **Push na Branch**: Enviar o commit para o repositório remoto (`git push origin main`).
5. **Tag e GitHub Action**: Criar a tag Git da nova versão (ex: `v1.0.25`) e enviá-la para o GitHub (`git tag v1.0.X` e `git push origin v1.0.X`), garantindo o disparo automático da GitHub Action de Release.
