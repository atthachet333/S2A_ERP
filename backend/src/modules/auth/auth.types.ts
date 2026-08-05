export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; username: string; roles: string[]; permissions: string[] };
    user: { sub: string; username: string; roles: string[]; permissions: string[] };
  }
}
