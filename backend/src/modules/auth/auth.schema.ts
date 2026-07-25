import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'El usuario es obligatorio.').max(100),
  password: z.string().min(1, 'La contraseña es obligatoria.').max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
