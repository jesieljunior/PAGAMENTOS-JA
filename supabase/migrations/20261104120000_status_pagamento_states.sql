-- Expansão dos estados do enum status_pagamento para acomodar ciclo completo de transferências bancárias
-- pendente -> processando / aguardando_aprovacao -> executado / falhou / estornado

ALTER TYPE public.status_pagamento ADD VALUE IF NOT EXISTS 'processando';
ALTER TYPE public.status_pagamento ADD VALUE IF NOT EXISTS 'aguardando_aprovacao';
ALTER TYPE public.status_pagamento ADD VALUE IF NOT EXISTS 'estornado';
