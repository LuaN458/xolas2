/**
 * In-memory Mock Prisma client for deterministic, fast, offline integration testing.
 */

class MockPrisma {
  constructor() {
    this.users = new Map();
    this.messages = new Map();
    this.customRoles = new Map();
    this.seedDefaults();
  }

  seedDefaults() {
    this.users.clear();
    this.messages.clear();
    this.customRoles.clear();

    const defaultUsers = [
      {
        id: 'user_alice',
        username: 'Alice',
        email: 'alice@example.com',
        role: 'USER',
        isApproved: true,
        approvalStatus: 'APPROVED',
        avatarUrl: 'https://example.com/alice.png',
        customRole: null,
      },
      {
        id: 'user_bob',
        username: 'Bob',
        email: 'bob@example.com',
        role: 'USER',
        isApproved: true,
        approvalStatus: 'APPROVED',
        avatarUrl: 'https://example.com/bob.png',
        customRole: null,
      },
      {
        id: 'user_carol',
        username: 'Carol',
        email: 'carol@example.com',
        role: 'USER',
        isApproved: true,
        approvalStatus: 'APPROVED',
        avatarUrl: 'https://example.com/carol.png',
        customRole: null,
      },
      {
        id: 'user_admin',
        username: 'AdminUser',
        email: 'admin@example.com',
        role: 'ADMIN',
        isApproved: true,
        approvalStatus: 'APPROVED',
        avatarUrl: 'https://example.com/admin.png',
        customRole: {
          permissions: ['manage_users', 'disconnect_voice', 'server_mute', 'delete_messages'],
        },
      },
      {
        id: 'user_pending',
        username: 'PendingUser',
        email: 'pending@example.com',
        role: 'USER',
        isApproved: false,
        approvalStatus: 'PENDING',
        avatarUrl: null,
        customRole: null,
      },
      {
        id: 'user_rejected',
        username: 'RejectedUser',
        email: 'rejected@example.com',
        role: 'USER',
        isApproved: false,
        approvalStatus: 'REJECTED',
        avatarUrl: null,
        customRole: null,
      },
    ];

    for (const u of defaultUsers) {
      this.users.set(u.id, { ...u });
    }
  }

  registerUser(userData) {
    const user = {
      role: 'USER',
      isApproved: true,
      approvalStatus: 'APPROVED',
      avatarUrl: null,
      customRole: null,
      ...userData,
    };
    this.users.set(user.id, user);
    return user;
  }

  reset() {
    this.seedDefaults();
  }

  get user() {
    const self = this;
    return {
      async findUnique(args) {
        const id = args?.where?.id;
        if (!id) return null;
        const u = self.users.get(id);
        if (!u) return null;

        // Emulate Prisma select projection
        if (args.select) {
          const res = {};
          for (const key of Object.keys(args.select)) {
            if (key === 'customRole') {
              res.customRole = u.customRole
                ? { permissions: u.customRole.permissions || [] }
                : null;
            } else {
              res[key] = u[key];
            }
          }
          return res;
        }
        return { ...u };
      },

      async findMany(args) {
        const roleId = args?.where?.customRoleId;
        const results = [];
        for (const u of self.users.values()) {
          if (!roleId || u.customRoleId === roleId) {
            results.push({ id: u.id, role: u.role });
          }
        }
        return results;
      },

      async count(args) {
        const status = args?.where?.approvalStatus;
        let count = 0;
        for (const u of self.users.values()) {
          if (!status || u.approvalStatus === status) {
            count++;
          }
        }
        return count;
      },
    };
  }

  get message() {
    const self = this;
    return {
      async create(args) {
        const data = args?.data || {};
        const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const user = self.users.get(data.userId) || {
          id: data.userId,
          username: 'Anonymous',
          avatarUrl: null,
        };

        const newMsg = {
          id: msgId,
          content: data.content,
          attachmentUrl: data.attachmentUrl || null,
          attachmentType: data.attachmentType || null,
          channelId: data.channelId,
          userId: data.userId,
          createdAt: new Date().toISOString(),
          user: {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
          },
        };

        self.messages.set(msgId, newMsg);
        return newMsg;
      },

      async findUnique(args) {
        const id = args?.where?.id;
        return id ? self.messages.get(id) || null : null;
      },

      async delete(args) {
        const id = args?.where?.id;
        if (id && self.messages.has(id)) {
          const deleted = self.messages.get(id);
          self.messages.delete(id);
          return deleted;
        }
        return null;
      },
    };
  }
}

const mockPrismaInstance = new MockPrisma();

module.exports = {
  mockPrisma: mockPrismaInstance,
  MockPrisma,
};
