import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middlewares/auth';
import { ensureScalarString, isValidIdentifier, sanitizeText } from '../middlewares/security';
import { notifyAdminsPendingUpdate, notifyUserApprovalStatus } from '../sockets/chatHandler';

const router = Router();

// Todas as rotas deste router exigem autenticação e privilégios de ADMIN
router.use(authMiddleware);
router.use(adminMiddleware);

// Listar usuários por status e contadores totais
router.get('/users', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const statusParam = req.query.status as string | undefined;

    const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
      prisma.user.count({ where: { approvalStatus: 'PENDING' } }),
      prisma.user.count({ where: { approvalStatus: 'APPROVED' } }),
      prisma.user.count({ where: { approvalStatus: 'REJECTED' } }),
    ]);

    const whereClause: any = {};
    if (statusParam && ['PENDING', 'APPROVED', 'REJECTED'].includes(statusParam)) {
      whereClause.approvalStatus = statusParam;
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        role: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            color: true,
            permissions: true,
          },
        },
        approvalStatus: true,
        isApproved: true,
        status: true,
        createdAt: true,
      },
      orderBy: [{ approvalStatus: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({
      users,
      counts: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        total: pendingCount + approvedCount + rejectedCount,
      },
    });
  } catch (error) {
    console.error('Erro ao listar usuários para o admin:', error);
    res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

// Aprovar usuário pendente
router.post('/users/:id/approve', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isValidIdentifier(id)) {
      res.status(400).json({ error: 'ID de usuário inválido.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        isApproved: true,
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        role: true,
        approvalStatus: true,
        isApproved: true,
        createdAt: true,
      },
    });

    // Inserir no servidor padrão ("Olá" ou primeiro servidor existente) se ainda não for membro
    try {
      const defaultServer =
        (await prisma.server.findFirst({
          where: { name: 'Olá' },
          orderBy: { createdAt: 'asc' },
        })) ||
        (await prisma.server.findFirst({
          orderBy: { createdAt: 'asc' },
        }));

      if (defaultServer) {
        await prisma.member.upsert({
          where: {
            userId_serverId: {
              userId: id,
              serverId: defaultServer.id,
            },
          },
          create: {
            userId: id,
            serverId: defaultServer.id,
            role: 'MEMBER',
          },
          update: {},
        });
      }
    } catch (err) {
      console.warn('Aviso: falha ao vincular usuário aprovado ao servidor padrão:', err);
    }

    // Notificar administradores para atualizar contadores e notificar o usuário aprovado
    await notifyAdminsPendingUpdate();
    notifyUserApprovalStatus(id, {
      status: 'APPROVED',
      user: updatedUser,
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Erro ao aprovar usuário:', error);
    res.status(500).json({ error: 'Erro ao aprovar usuário.' });
  }
});

// Recusar solicitação de usuário
router.post('/users/:id/reject', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isValidIdentifier(id)) {
      res.status(400).json({ error: 'ID de usuário inválido.' });
      return;
    }

    if (id === req.user!.userId) {
      res.status(400).json({ error: 'Você não pode recusar seu próprio usuário.' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        isApproved: false,
      },
      select: {
        id: true,
        username: true,
        approvalStatus: true,
        isApproved: true,
      },
    });

    await notifyAdminsPendingUpdate();
    notifyUserApprovalStatus(id, {
      status: 'REJECTED',
      user: updatedUser,
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Erro ao recusar usuário:', error);
    res.status(500).json({ error: 'Erro ao recusar usuário.' });
  }
});

// Excluir permanentemente o cadastro de um usuário
router.delete('/users/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isValidIdentifier(id)) {
      res.status(400).json({ error: 'ID de usuário inválido.' });
      return;
    }

    if (id === req.user!.userId) {
      res.status(400).json({ error: 'Você não pode excluir sua própria conta pelo painel.' });
      return;
    }

    await prisma.user.delete({
      where: { id },
    });

    await notifyAdminsPendingUpdate();
    notifyUserApprovalStatus(id, { status: 'DELETED' });

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao excluir usuário:', error);
    res.status(500).json({ error: 'Erro ao excluir usuário.' });
  }
});

// Alterar papel do usuário (ADMIN <-> USER)
router.patch('/users/:id/role', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { role } = req.body;

    if (!isValidIdentifier(id) || !['ADMIN', 'USER'].includes(role)) {
      res.status(400).json({ error: 'Parâmetros inválidos.' });
      return;
    }

    // Se for auto-despromoção, verifica se ainda resta ao menos mais um admin
    if (id === req.user!.userId && role !== 'ADMIN') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        res.status(400).json({
          error: 'Não é possível remover o único administrador do sistema.',
        });
        return;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            color: true,
            permissions: true,
          },
        },
        approvalStatus: true,
        isApproved: true,
      },
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Erro ao alterar papel do usuário:', error);
    res.status(500).json({ error: 'Erro ao alterar papel.' });
  }
});

// Listar todos os cargos do sistema com contagem de usuários
router.get('/roles', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const roles = await prisma.customRole.findMany({
      include: {
        _count: {
          select: { users: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formatted = roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      permissions: r.permissions,
      isDefault: r.isDefault,
      userCount: r._count.users,
      createdAt: r.createdAt,
    }));

    res.json({ roles: formatted });
  } catch (error) {
    console.error('Erro ao listar cargos:', error);
    res.status(500).json({ error: 'Erro ao buscar cargos.' });
  }
});

// Criar novo cargo
router.post('/roles', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawName = ensureScalarString(req.body?.name, 32);
    const rawColor = ensureScalarString(req.body?.color, 16) || '#6366f1';
    const permissions = Array.isArray(req.body?.permissions)
      ? req.body.permissions.filter((p: unknown) => typeof p === 'string' && p.length <= 64)
      : [];

    const cleanName = sanitizeText(rawName || '', 32);
    if (!cleanName || cleanName.length < 2) {
      res.status(400).json({ error: 'O nome do cargo deve ter entre 2 e 32 caracteres.' });
      return;
    }

    const existing = await prisma.customRole.findFirst({
      where: { name: cleanName },
    });
    if (existing) {
      res.status(400).json({ error: 'Já existe um cargo com esse nome.' });
      return;
    }

    const role = await prisma.customRole.create({
      data: {
        name: cleanName,
        color: rawColor,
        permissions,
      },
    });

    res.status(201).json({ role: { ...role, userCount: 0 } });
  } catch (error) {
    console.error('Erro ao criar cargo:', error);
    res.status(500).json({ error: 'Erro interno ao criar cargo.' });
  }
});

// Atualizar cargo (nome, cor ou permissões)
router.patch('/roles/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isValidIdentifier(id)) {
      res.status(400).json({ error: 'ID de cargo inválido.' });
      return;
    }

    const updateData: { name?: string; color?: string; permissions?: string[] } = {};
    if (req.body?.name) {
      const cleanName = sanitizeText(req.body.name, 32);
      if (cleanName.length < 2) {
        res.status(400).json({ error: 'O nome do cargo deve ter entre 2 e 32 caracteres.' });
        return;
      }
      const existing = await prisma.customRole.findFirst({
        where: { name: cleanName, NOT: { id } },
      });
      if (existing) {
        res.status(400).json({ error: 'Já existe outro cargo com esse nome.' });
        return;
      }
      updateData.name = cleanName;
    }
    if (req.body?.color && typeof req.body.color === 'string') {
      updateData.color = req.body.color.slice(0, 16);
    }
    if (Array.isArray(req.body?.permissions)) {
      updateData.permissions = req.body.permissions.filter(
        (p: unknown) => typeof p === 'string' && p.length <= 64
      );
    }

    const updatedRole = await prisma.customRole.update({
      where: { id },
      data: updateData,
      include: {
        _count: { select: { users: true } },
      },
    });

    res.json({
      role: {
        id: updatedRole.id,
        name: updatedRole.name,
        color: updatedRole.color,
        permissions: updatedRole.permissions,
        isDefault: updatedRole.isDefault,
        userCount: updatedRole._count.users,
      },
    });
  } catch (error) {
    console.error('Erro ao atualizar cargo:', error);
    res.status(500).json({ error: 'Erro ao atualizar cargo.' });
  }
});

// Excluir cargo
router.delete('/roles/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isValidIdentifier(id)) {
      res.status(400).json({ error: 'ID de cargo inválido.' });
      return;
    }

    await prisma.customRole.delete({
      where: { id },
    });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Erro ao excluir cargo:', error);
    res.status(500).json({ error: 'Erro ao excluir cargo.' });
  }
});

// Atribuir cargo customizado a um usuário
router.patch('/users/:id/custom-role', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { customRoleId } = req.body;

    if (!isValidIdentifier(id)) {
      res.status(400).json({ error: 'ID de usuário inválido.' });
      return;
    }

    if (customRoleId && !isValidIdentifier(customRoleId)) {
      res.status(400).json({ error: 'ID de cargo inválido.' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        customRoleId: customRoleId || null,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            color: true,
            permissions: true,
          },
        },
        approvalStatus: true,
        isApproved: true,
      },
    });

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Erro ao atribuir cargo ao usuário:', error);
    res.status(500).json({ error: 'Erro ao atribuir cargo.' });
  }
});

export default router;
