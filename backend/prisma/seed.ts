import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

const ROLE_NAMES = ['Administrador', 'Supervisor', 'User'];

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

  // Sectores de referencia: catalogo minimo para arrancar sin la plataforma vacia.
  const sectorNames = ['Administración', 'Sistemas'];
  const sectors = new Map<string, string>();
  for (const name of sectorNames) {
    const sector = await prisma.sector.upsert({ where: { name }, update: {}, create: { name } });
    sectors.set(name, sector.id);
  }

  // Turnos de soporte de referencia.
  const scheduleDefs = [
    { name: 'Mañana', startTime: '07:30', endTime: '14:30' },
    { name: 'Tarde', startTime: '14:30', endTime: '21:00' },
  ];
  const schedules = new Map<string, string>();
  for (const def of scheduleDefs) {
    const schedule = await prisma.schedule.upsert({ where: { name: def.name }, update: {}, create: def });
    schedules.set(def.name, schedule.id);
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
      sectorId: sectors.get('Administración'),
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
      model: 'Dell OptiPlex',
      status: 'Activo',
      sectorId: sectors.get('Administración'),
    },
  });

  const existingEmployeeUser = await prisma.user.findUnique({ where: { employeeId: referenceEmployee.id } });
  if (!existingEmployeeUser) {
    await prisma.user.create({
      data: {
        name: referenceEmployee.name,
        username: 'mgonzalez',
        passwordHash: await bcrypt.hash('empleado123', SALT_ROUNDS),
        roleId: roles.get('User')!,
        employeeId: referenceEmployee.id,
        status: 'Activo',
      },
    });
    console.log('Usuario de referencia creado: mgonzalez / empleado123');
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
      sectorId: referenceEmployee.sectorId,
      scheduleId: schedules.get('Mañana'),
      category: 'Otro',
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
