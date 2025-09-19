import dayjs from 'dayjs';

const birthDate = dayjs('02/28/1998');

export const returnEstd = (): { days: string; hours: string; minuets: string } => {
  const curentDate = dayjs();
  const dateDifferancSec = curentDate.diff(birthDate, 's');

  const days = Math.floor(dateDifferancSec / 86400);
  const hours = Math.floor((dateDifferancSec - days * 86400) / 3600);
  const minuets = Math.floor((dateDifferancSec - days * 86400 - hours * 3600) / 60);

  return {
    days: String(days),
    hours: hours.toLocaleString(undefined, { minimumIntegerDigits: 2 }),
    minuets: minuets.toLocaleString(undefined, { minimumIntegerDigits: 2 }),
  };
};
