export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
  companies: AuthCompany[];
  activeCompany: AuthCompany | null;
  defaultLandingPage: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthCompany {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string | null;
  logoUrl: string | null;
  role: string;
  isDefault: boolean;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; username: string; roles: string[]; permissions: string[]; companyId?: string };
    user: { sub: string; username: string; roles: string[]; permissions: string[]; companyId?: string };
  }
}
