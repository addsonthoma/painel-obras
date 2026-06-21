-- =====================================================================
--  MONITORAMENTO — campos extras. Rode no SQL Editor (idempotente).
-- =====================================================================

-- 1) "valor" da multa (digitado à mão pelo admin).
--    O e-SCI não devolve o valor no retorno do bloco; este campo permite
--    registrar manualmente o valor de cada multa/auto.
alter table public.monitor_autos add column if not exists valor numeric(12,2);

-- 2) "funcionamento_validade" (validade exata vinda do e-SCI).
--    Pendência antiga: a tabela foi criada sem esta coluna, então o coletor só
--    gravava a emissão. Com a coluna, o próximo ciclo grava a validade real
--    (senão o app calcula emissão + 1 ano).
alter table public.monitor_res add column if not exists funcionamento_validade date;
