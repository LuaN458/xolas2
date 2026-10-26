# Regras e Diretrizes do Projeto Xolas

## Ciclo de Finalização de Tarefas (Obrigatório)
Sempre que finalizar qualquer tarefa, modificação ou correção no projeto:
1. **Incremento de Versão**: Incrementar o patch version em `package.json` e `client/package.json` (ex: `1.0.24` -> `1.0.25`).
2. **Validação de Build**: Executar `npm --prefix client run build` para garantir que o TypeScript e o Vite compilam sem nenhum erro.
3. **Commit no Git**: Adicionar os arquivos modificados e criar o commit com mensagem clara e padronizada (Conventional Commits, ex: `feat(...)`, `fix(...)`).
4. **Push na Branch**: Enviar o commit para o repositório remoto (`git push origin main`).
5. **Tag e GitHub Action**: Criar a tag Git da nova versão (ex: `v1.0.25`) e enviá-la para o GitHub (`git tag v1.0.X` e `git push origin v1.0.X`), garantindo o disparo automático da GitHub Action de Release.
