const birthDate = Temporal.PlainDateTime.from('1998-02-28T00:00').toZonedDateTime(Temporal.Now.timeZoneId());

export const returnEstd = (): { days: string; hours: string; minuets: string } => {
  const { days, hours, minutes: minuets } = Temporal.Now.zonedDateTimeISO().since(birthDate, { largestUnit: 'day' });

  return {
    days: String(days),
    hours: hours.toLocaleString(undefined, { minimumIntegerDigits: 2 }),
    minuets: minuets.toLocaleString(undefined, { minimumIntegerDigits: 2 }),
  };
};
