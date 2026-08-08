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

  // ---------------------------------------------------------------------
  // DATOS DE DEMOSTRACION: solo en la PRIMERA instalacion.
  //
  // El seed corre en cada arranque (para garantizar que siempre exista un
  // Administrador), pero los datos de ejemplo no deben volver a crearse en
  // una plataforma que ya esta en uso: si el Administrador borro una
  // categoria o un sector de ejemplo, tiene que quedar borrado, no
  // reaparecer en el proximo reinicio o actualizacion.
  // ---------------------------------------------------------------------
  const [sectorCount, employeeCount, ticketCount] = await Promise.all([
    prisma.sector.count(),
    prisma.employee.count(),
    prisma.ticket.count(),
  ]);
  const yaEnUso = sectorCount > 0 || employeeCount > 0 || ticketCount > 0;
  if (yaEnUso) {
    console.log('La plataforma ya tiene datos: se conservan tal cual (no se cargan datos de ejemplo).');
    console.log('Seed completado.');
    return;
  }

  // Sectores de referencia: catalogo minimo para arrancar sin la plataforma vacia.
  const sectorNames = ['Administración', 'Sistemas'];
  const sectors = new Map<string, string>();
  for (const name of sectorNames) {
    const sector = await prisma.sector.upsert({ where: { name }, update: {}, create: { name } });
    sectors.set(name, sector.id);
  }

  // Categorias de ticket de referencia, propias de cada sector: muestran la
  // idea de que cada area define las suyas (Sistemas recibe pedidos
  // informaticos; Administracion, pedidos administrativos).
  const categoryDefs: Record<string, string[]> = {
    Sistemas: ['Acceso / contraseña', 'Aplicación / sistema', 'Hardware', 'Impresión', 'Red / conectividad'],
    Administración: ['Consulta', 'Documentación', 'Otro'],
  };
  for (const [sectorName, names] of Object.entries(categoryDefs)) {
    const sectorId = sectors.get(sectorName);
    if (!sectorId) continue;
    for (const name of names) {
      await prisma.ticketCategory.upsert({
        where: { sectorId_name: { sectorId, name } },
        update: {},
        create: { sectorId, name },
      });
    }
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
      email: 'mgonzalez@empresa.local',
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

  // Conversacion de referencia (chat interno) entre el admin y el usuario de
  // ejemplo, para poder probar el circuito completo sin cargar datos a mano.
  const adminUser = await prisma.user.findUnique({ where: { username: adminUsername } });
  const employeeUser = await prisma.user.findUnique({ where: { employeeId: referenceEmployee.id } });
  if (adminUser && employeeUser) {
    const [userAId, userBId] = [adminUser.id, employeeUser.id].sort();
    const conversation = await prisma.conversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: {},
      create: { userAId, userBId },
    });
    const existingMessage = await prisma.message.findFirst({ where: { conversationId: conversation.id } });
    if (!existingMessage) {
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: adminUser.id,
          body: 'Hola María, cualquier consulta sobre tu ticket me escribís por acá.',
        },
      });
      await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
      console.log('Conversacion de referencia creada entre admin y mgonzalez.');
    }
  }

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
