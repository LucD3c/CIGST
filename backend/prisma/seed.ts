import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

const ROLE_NAMES = ['Administrador', 'Técnico', 'Empleado'];

async function main() {
  const roles = new Map<string, string>();
  for (const name of ROLE_NAMES) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roles.set(name, role.id);
  }

  const adminUsername = process.env.SEED_ADMIN_USERNAME?.trim() || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || 'admin123';

  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        name: 'Administrador de Sistemas',
        username: adminUsername,
        passwordHash: await bcrypt.hash(adminPassword, SALT_ROUNDS),
        roleId: roles.get('Administrador')!,
        status: 'Activo',
      },
    });
    console.log(`Usuario administrador creado: ${adminUsername} / (contrasena definida por SEED_ADMIN_PASSWORD o el valor por defecto)`);
  } else {
    console.log(`Usuario administrador "${adminUsername}" ya existe, no se modifica.`);
  }

  // Caso de referencia (equivalente al que traia la version local en localStorage)
  // para poder probar el circuito completo apenas se levanta el entorno.
  const referenceEmployee = await prisma.employee.upsert({
    where: { code: 'EMP-001' },
    update: {},
    create: {
      code: 'EMP-001',
      name: 'María González',
      email: 'mgonzalez@centromedico.com',
      extension: '101',
      sector: 'Administración',
      position: 'Colaboradora',
      status: 'Activo',
      workShift: 'Mañana',
      schedule: '07:30–14:30',
    },
  });

  const referenceEquipment = await prisma.equipment.upsert({
    where: { code: 'EQ-001' },
    update: {},
    create: {
      code: 'EQ-001',
      type: 'PC',
      brand: 'Dell',
      model: 'OptiPlex',
      asset: 'AF-001',
      status: 'Operativo',
      employeeId: referenceEmployee.id,
      location: 'Administración',
      warranty: 'No registrada',
    },
  });

  const existingEmployeeUser = await prisma.user.findUnique({ where: { employeeId: referenceEmployee.id } });
  if (!existingEmployeeUser) {
    await prisma.user.create({
      data: {
        name: referenceEmployee.name,
        username: 'mgonzalez',
        passwordHash: await bcrypt.hash('empleado123', SALT_ROUNDS),
        roleId: roles.get('Empleado')!,
        employeeId: referenceEmployee.id,
        status: 'Activo',
      },
    });
    console.log('Usuario empleado de referencia creado: mgonzalez / empleado123');
  }

  await prisma.ticket.upsert({
    where: { code: 'TK-001' },
    update: {},
    create: {
      code: 'TK-001',
      title: 'Ejemplo de solicitud de soporte',
      description: 'Solicitud de referencia para validar el circuito local.',
      employeeId: referenceEmployee.id,
      requestedById: referenceEmployee.id,
      equipmentId: referenceEquipment.id,
      location: referenceEmployee.sector,
      contact: 'Interno telefónico',
      availability: referenceEmployee.schedule,
      supportShift: referenceEmployee.workShift,
      category: 'Otro',
      impact: 'Individual',
      status: 'Nuevo',
      priority: 'Media',
    },
  });

  console.log('Seed completado.');
}

main()
  .catch((err) => {
    console.error('Fallo el seed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
