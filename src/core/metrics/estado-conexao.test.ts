import { describe, expect, it } from 'vitest';
import {
  descreverIdade,
  estadoDaConexao,
  frescorDaConexao,
  haQuantoTempo,
  intervaloEsperadoMinutos,
  isSyncStale,
} from './estado-conexao';

const AGORA = new Date('2026-09-03T18:00:00Z');
const hAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000);

describe('frescorDaConexao — a conta vale o seu PIOR recurso', () => {
  it('o e-mail recente nao cobre a agenda parada', () => {
    // Este e o bug que o campo `Connection.lastSyncAt` escondia: ele e
    // gravado quando QUALQUER recurso termina bem.
    const frescor = frescorDaConexao(
      { lastSyncAt: hAtras(0.1) },
      [
        { resource: 'MAIL', lastSyncAt: hAtras(0.1) },
        { resource: 'CALENDAR', lastSyncAt: hAtras(40) },
      ],
      AGORA,
    );
    expect(frescor.recurso).toBe('CALENDAR');
    expect(frescor.minutos).toBe(40 * 60);
  });

  it('recurso que nunca sincronizou domina qualquer data', () => {
    const frescor = frescorDaConexao(
      { lastSyncAt: hAtras(0.1) },
      [
        { resource: 'MAIL', lastSyncAt: hAtras(0.1) },
        { resource: 'CALENDAR', lastSyncAt: null },
      ],
      AGORA,
    );
    expect(frescor.desde).toBeNull();
    expect(frescor.recurso).toBe('CALENDAR');
    expect(frescor.minutos).toBeNull();
  });

  it('sem linhas de SyncState, cai para o campo da conexao', () => {
    const frescor = frescorDaConexao({ lastSyncAt: hAtras(2) }, [], AGORA);
    expect(frescor.desde).toEqual(hAtras(2));
    expect(frescor.recurso).toBeNull();
    expect(frescor.minutos).toBe(120);
  });

  it('nao inventa idade negativa quando o relogio anda para tras', () => {
    const futuro = new Date(AGORA.getTime() + 5 * 60_000);
    expect(frescorDaConexao({ lastSyncAt: futuro }, [], AGORA).minutos).toBe(0);
  });
});

describe('descreverIdade', () => {
  it('escreve o que da para ler, nao minutos crus', () => {
    expect(descreverIdade(null)).toBe('nunca sincronizou');
    expect(descreverIdade(0)).toBe('agora mesmo');
    expect(descreverIdade(40)).toBe('há 40min');
    expect(descreverIdade(680)).toBe('há 11h');
    expect(descreverIdade(35 * 60)).toBe('há 35h');
    expect(descreverIdade(48 * 60)).toBe('há 2 dias');
    expect(descreverIdade(24 * 60 + 60)).toBe('há 25h');
    expect(descreverIdade(5 * 24 * 60)).toBe('há 5 dias');
  });

  it('nao diz "1 dias"', () => {
    expect(descreverIdade(36 * 60)).toBe('há 2 dias');
    expect(descreverIdade(30 * 60)).not.toContain('dia');
  });

  it('haQuantoTempo e a mesma regua, a partir de uma data', () => {
    expect(haQuantoTempo(null, AGORA)).toBe('nunca sincronizou');
    expect(haQuantoTempo(hAtras(11), AGORA)).toBe('há 11h');
  });
});

describe('estadoDaConexao — uma etiqueta so para todas as telas', () => {
  const recente = { desde: hAtras(2) };
  const antiga = { desde: hAtras(30) };

  it('o que exige voce vem antes do que se resolve sozinho', () => {
    // Uma conta parada por reautenticacao TAMBEM esta atrasada; dizer as
    // duas coisas seria dizer a mesma duas vezes.
    expect(estadoDaConexao({ status: 'REAUTH_REQUIRED' }, antiga, AGORA)).toEqual({
      classe: 'crit',
      texto: 'reautenticar',
      atrasada: false,
    });
    expect(estadoDaConexao({ status: 'ERROR' }, antiga, AGORA).texto).toBe('erro');
  });

  it('desativada nunca e "atrasada": ela nao deve sync nenhum', () => {
    const estado = estadoDaConexao({ status: 'DISABLED' }, { desde: null }, AGORA);
    expect(estado.texto).toBe('desativada');
    expect(estado.atrasada).toBe(false);
  });

  it('ativa e recente e "ativa"; ativa e velha e "atrasada"', () => {
    expect(estadoDaConexao({ status: 'ACTIVE' }, recente, AGORA).texto).toBe('ativa');
    expect(estadoDaConexao({ status: 'ACTIVE' }, antiga, AGORA)).toEqual({
      classe: 'warn',
      texto: 'atrasada',
      atrasada: true,
    });
  });

  it('conta que nunca sincronizou nao passa por "ativa"', () => {
    expect(estadoDaConexao({ status: 'ACTIVE' }, { desde: null }, AGORA).texto).toBe('atrasada');
  });

  it('DEGRADED em dia continua degradada', () => {
    expect(estadoDaConexao({ status: 'DEGRADED' }, recente, AGORA).texto).toBe('degradada');
  });
});

describe('isSyncStale — a regua e a CADENCIA, nao o conector', () => {
  const agora = new Date('2026-08-30T12:00:00Z');
  const horasAtras = (h: number) => new Date(agora.getTime() - h * 3600_000);
  const CADENCIA = intervaloEsperadoMinutos();

  it('trata conta que nunca sincronizou como problema, nao como estado neutro', () => {
    expect(isSyncStale(null, CADENCIA, agora)).toBe(true);
  });

  it('o padrao e o maior intervalo normal do agendamento: 12 horas', () => {
    // O agendamento roda 3x por dia (10h, 16h, 22h UTC); o maior vao e o da
    // noite. O conector diz `pollIntervalSeconds: 300`, mas isso e "da para
    // me ler a cada 5 min", nao "sou lido a cada 5 min".
    expect(CADENCIA).toBe(720);
  });

  it('silencio NORMAL entre dois ciclos nao e atraso', () => {
    // Era exatamente isto que ficava vermelho o tempo todo: qualquer coisa
    // acima de 15 minutos.
    for (const h of [0.5, 2, 6, 11]) {
      expect(isSyncStale(horasAtras(h), CADENCIA, agora)).toBe(false);
    }
  });

  it('tolera o ciclo atrasar, mas acusa o ciclo PERDIDO', () => {
    // 12h + 25% = 15h. Perder um ciclo produz 18h ou mais.
    expect(isSyncStale(horasAtras(14), CADENCIA, agora)).toBe(false);
    expect(isSyncStale(horasAtras(16), CADENCIA, agora)).toBe(true);
    expect(isSyncStale(horasAtras(24), CADENCIA, agora)).toBe(true);
  });

  it('cadencia menor aperta a regua na mesma proporcao', () => {
    // Quem mudar o agendamento ajusta SYNC_EXPECTED_INTERVAL_MINUTES.
    expect(isSyncStale(horasAtras(2), 60, agora)).toBe(true);
    expect(isSyncStale(horasAtras(1), 60, agora)).toBe(false);
  });
});

describe('intervaloEsperadoMinutos', () => {
  it('respeita a variavel de ambiente quando ela e valida', () => {
    process.env.SYNC_EXPECTED_INTERVAL_MINUTES = '90';
    expect(intervaloEsperadoMinutos()).toBe(90);
    for (const lixo of ['0', '-5', 'abc', '']) {
      process.env.SYNC_EXPECTED_INTERVAL_MINUTES = lixo;
      expect(intervaloEsperadoMinutos()).toBe(720);
    }
    delete process.env.SYNC_EXPECTED_INTERVAL_MINUTES;
  });
});
