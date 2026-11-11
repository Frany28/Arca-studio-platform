-- Estado pending de los usuarios: cuenta de cliente creada desde una cotización solo con su nombre,
-- todavía sin correo verificado ni contraseña. No puede iniciar sesión ni recuperar contraseña; solo
-- el flujo de activación por correo la convierte en active.
--
-- Solo añade el valor al enum. PostgreSQL no permite usar un valor nuevo en la misma transacción
-- que lo crea, así que las restricciones que lo mencionan van en la migración siguiente
-- (20261110131000_pending_client_accounts), igual que 'draft' en project_status.
-- No modifica filas, triggers ni secuencias.
ALTER TYPE public.user_status ADD VALUE IF NOT EXISTS 'pending';
