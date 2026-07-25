import { z } from 'zod';
import { nullableUuid } from '../../utils/commonSchemas';
import { ROLES } from '../../middleware/rbac.middleware';

export const roleValues = [ROLES.ADMIN, ROLES.TECH, ROLES.EMPLOYEE] as const;
export const userStatusValues = ['Activo', 'Inactivo'] as const;

const usernamePattern = /^[a-z0-9._-]+$/i;

export const createUserSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
    username: z
      .string()
      .trim()
      .min(3, 'El usuario debe tener al menos 3 caracteres.')
      .max(50)
      .regex(usernamePattern, 'El usuario solo admite letras, números, punto, guion y guion bajo.'),
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(200),
    role: z.enum(roleValues),
    employeeId: nullableUuid,
  })
  .refine((data) => data.role !== ROLES.EMPLOYEE || Boolean(data.employeeId), {
    message: 'Un usuario de rol Empleado debe estar vinculado a una persona.',
    path: ['employeeId'],
  });

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  role: z.enum(roleValues).optional(),
  employeeId: nullableUuid,
  status: z.enum(userStatusValues).optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(200).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
