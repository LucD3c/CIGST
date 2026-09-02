import { z } from 'zod';
import { nullableUuid } from '../../utils/commonSchemas';
import { ROLES } from '../../middleware/rbac.middleware';
import { motivoRechazo, LARGO_MAXIMO } from '../../utils/passwordPolicy';

export const roleValues = [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.USER] as const;
export const userStatusValues = ['Activo', 'Inactivo'] as const;

const usernamePattern = /^[a-z0-9._-]+$/i;

// La validacion de la contrasena vive en utils/passwordPolicy para que sea la
// misma en el alta, en la edicion y en el cambio de contrasena propia. El
// mensaje que se devuelve dice exactamente que falta, no un "no cumple" seco.
const passwordSchema = z
  .string()
  .max(LARGO_MAXIMO)
  .superRefine((valor, ctx) => {
    const motivo = motivoRechazo(valor);
    if (motivo) ctx.addIssue({ code: z.ZodIssueCode.custom, message: motivo });
  });

export const createUserSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
    username: z
      .string()
      .trim()
      .min(3, 'El usuario debe tener al menos 3 caracteres.')
      .max(50)
      .regex(usernamePattern, 'El usuario solo admite letras, números, punto, guion y guion bajo.'),
    password: passwordSchema,
    role: z.enum(roleValues),
    employeeId: nullableUuid,
  })
  .refine((data) => data.role !== ROLES.USER || Boolean(data.employeeId), {
    message: 'Un usuario de rol User debe estar vinculado a una persona.',
    path: ['employeeId'],
  })
  // La contrasena no puede ser el propio nombre de usuario: es lo primero que
  // prueba cualquiera que conozca a la persona.
  .refine((data) => !motivoRechazo(data.password, data.username), {
    message: 'La contraseña no puede contener el nombre de usuario.',
    path: ['password'],
  });

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  role: z.enum(roleValues).optional(),
  employeeId: nullableUuid,
  status: z.enum(userStatusValues).optional(),
  password: passwordSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
