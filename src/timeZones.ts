/**
 * IANA time zone to ISO 3166-1 alpha-2 country, for prefilling the default country from the
 * Homebridge host's time zone on a fresh install (SPEC section 11.2, item 21). A small static table
 * of the zones people actually run Homebridge in, not a copy of the tz database: an unknown zone
 * simply yields no country and the caller falls back to US. Zones shared by several countries
 * (`Etc/UTC`, `UTC`) are left out on purpose.
 */
const ZONE_COUNTRY: Readonly<Record<string, string>> = {
  // United States and Canada
  'America/New_York': 'US', 'America/Detroit': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Phoenix': 'US',
  'America/Los_Angeles': 'US', 'America/Anchorage': 'US', 'America/Juneau': 'US', 'America/Boise': 'US', 'America/Indiana/Indianapolis': 'US',
  'America/Indianapolis': 'US', 'America/Kentucky/Louisville': 'US', 'America/Louisville': 'US', 'America/Menominee': 'US',
  'America/North_Dakota/Center': 'US', 'America/Adak': 'US', 'America/Nome': 'US', 'America/Sitka': 'US', 'America/Yakutat': 'US',
  'America/Metlakatla': 'US', 'Pacific/Honolulu': 'US', 'US/Eastern': 'US', 'US/Central': 'US', 'US/Mountain': 'US', 'US/Pacific': 'US',
  'US/Arizona': 'US', 'US/Alaska': 'US', 'US/Hawaii': 'US',
  'America/Toronto': 'CA', 'America/Montreal': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA',
  'America/Halifax': 'CA', 'America/St_Johns': 'CA', 'America/Regina': 'CA', 'America/Moncton': 'CA', 'America/Whitehorse': 'CA',
  'America/Yellowknife': 'CA', 'America/Iqaluit': 'CA', 'Canada/Eastern': 'CA', 'Canada/Central': 'CA', 'Canada/Mountain': 'CA',
  'Canada/Pacific': 'CA', 'Canada/Atlantic': 'CA', 'Canada/Newfoundland': 'CA',
  // Latin America and the Caribbean
  'America/Mexico_City': 'MX', 'America/Cancun': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX', 'America/Chihuahua': 'MX',
  'America/Hermosillo': 'MX', 'America/Merida': 'MX', 'America/Guatemala': 'GT', 'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN',
  'America/Managua': 'NI', 'America/Costa_Rica': 'CR', 'America/Panama': 'PA', 'America/Havana': 'CU', 'America/Jamaica': 'JM',
  'America/Santo_Domingo': 'DO', 'America/Puerto_Rico': 'PR', 'America/Port_of_Spain': 'TT', 'America/Barbados': 'BB', 'America/Nassau': 'BS',
  'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Caracas': 'VE', 'America/Guayaquil': 'EC', 'America/La_Paz': 'BO',
  'America/Santiago': 'CL', 'America/Argentina/Buenos_Aires': 'AR', 'America/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR',
  'America/Montevideo': 'UY', 'America/Asuncion': 'PY', 'America/Sao_Paulo': 'BR', 'America/Fortaleza': 'BR', 'America/Recife': 'BR',
  'America/Bahia': 'BR', 'America/Manaus': 'BR', 'America/Belem': 'BR', 'America/Cuiaba': 'BR', 'America/Campo_Grande': 'BR', 'America/Porto_Velho': 'BR',
  'America/Boa_Vista': 'BR', 'America/Maceio': 'BR', 'America/Araguaina': 'BR', 'America/Noronha': 'BR', 'America/Rio_Branco': 'BR',
  // Europe
  'Europe/London': 'GB', 'GB': 'GB', 'Europe/Belfast': 'GB', 'Europe/Dublin': 'IE', 'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT',
  'Atlantic/Azores': 'PT', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Africa/Ceuta': 'ES', 'Europe/Paris': 'FR', 'Europe/Brussels': 'BE',
  'Europe/Amsterdam': 'NL', 'Europe/Luxembourg': 'LU', 'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT',
  'Europe/Rome': 'IT', 'Europe/Vatican': 'VA', 'Europe/San_Marino': 'SM', 'Europe/Malta': 'MT', 'Europe/Monaco': 'MC', 'Europe/Andorra': 'AD',
  'Europe/Gibraltar': 'GI', 'Europe/Copenhagen': 'DK', 'Atlantic/Faroe': 'FO', 'America/Nuuk': 'GL', 'America/Godthab': 'GL', 'Europe/Oslo': 'NO',
  'Europe/Stockholm': 'SE', 'Europe/Helsinki': 'FI', 'Europe/Mariehamn': 'AX', 'Atlantic/Reykjavik': 'IS', 'Europe/Tallinn': 'EE', 'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Bratislava': 'SK', 'Europe/Budapest': 'HU', 'Europe/Ljubljana': 'SI',
  'Europe/Zagreb': 'HR', 'Europe/Sarajevo': 'BA', 'Europe/Belgrade': 'RS', 'Europe/Podgorica': 'ME', 'Europe/Skopje': 'MK', 'Europe/Tirane': 'AL',
  'Europe/Athens': 'GR', 'Europe/Sofia': 'BG', 'Europe/Bucharest': 'RO', 'Europe/Chisinau': 'MD', 'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA',
  'Europe/Minsk': 'BY', 'Europe/Moscow': 'RU', 'Europe/Kaliningrad': 'RU', 'Europe/Samara': 'RU', 'Asia/Yekaterinburg': 'RU', 'Asia/Novosibirsk': 'RU',
  'Asia/Krasnoyarsk': 'RU', 'Asia/Irkutsk': 'RU', 'Asia/Vladivostok': 'RU', 'Europe/Istanbul': 'TR', 'Asia/Istanbul': 'TR', 'Asia/Nicosia': 'CY',
  'Europe/Nicosia': 'CY', 'Europe/Jersey': 'JE', 'Europe/Guernsey': 'GG', 'Europe/Isle_of_Man': 'IM', 'Europe/Vaduz': 'LI',
  // Middle East and Africa
  'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Asia/Beirut': 'LB', 'Asia/Amman': 'JO', 'Asia/Damascus': 'SY', 'Asia/Baghdad': 'IQ',
  'Asia/Riyadh': 'SA', 'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH', 'Asia/Qatar': 'QA', 'Asia/Dubai': 'AE', 'Asia/Muscat': 'OM', 'Asia/Tehran': 'IR',
  'Africa/Cairo': 'EG', 'Africa/Tripoli': 'LY', 'Africa/Tunis': 'TN', 'Africa/Algiers': 'DZ', 'Africa/Casablanca': 'MA', 'Africa/Lagos': 'NG',
  'Africa/Accra': 'GH', 'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Nairobi': 'KE', 'Africa/Kampala': 'UG', 'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Addis_Ababa': 'ET', 'Africa/Johannesburg': 'ZA', 'Africa/Maputo': 'MZ', 'Africa/Harare': 'ZW', 'Africa/Lusaka': 'ZM', 'Africa/Windhoek': 'NA',
  'Africa/Gaborone': 'BW', 'Africa/Kinshasa': 'CD', 'Africa/Luanda': 'AO', 'Indian/Mauritius': 'MU', 'Indian/Reunion': 'RE',
  // Asia and the Pacific
  'Asia/Karachi': 'PK', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Colombo': 'LK', 'Asia/Dhaka': 'BD', 'Asia/Kathmandu': 'NP',
  'Asia/Katmandu': 'NP', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Phnom_Penh': 'KH', 'Asia/Vientiane': 'LA',
  'Asia/Yangon': 'MM', 'Asia/Rangoon': 'MM', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY', 'Asia/Singapore': 'SG', 'Asia/Jakarta': 'ID',
  'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Manila': 'PH', 'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Taipei': 'TW',
  'Asia/Shanghai': 'CN', 'Asia/Chongqing': 'CN', 'Asia/Urumqi': 'CN', 'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP', 'Japan': 'JP', 'Asia/Ulaanbaatar': 'MN',
  'Asia/Almaty': 'KZ', 'Asia/Tashkent': 'UZ', 'Asia/Baku': 'AZ', 'Asia/Tbilisi': 'GE', 'Asia/Yerevan': 'AM', 'Asia/Kabul': 'AF',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU',
  'Australia/Hobart': 'AU', 'Australia/Darwin': 'AU', 'Australia/Canberra': 'AU', 'Australia/ACT': 'AU', 'Australia/NSW': 'AU', 'Australia/Queensland': 'AU',
  'Australia/Victoria': 'AU', 'Australia/West': 'AU', 'Australia/South': 'AU', 'Australia/Tasmania': 'AU', 'Australia/Lord_Howe': 'AU',
  'Australia/Broken_Hill': 'AU', 'Australia/Lindeman': 'AU', 'Australia/Eucla': 'AU', 'Pacific/Auckland': 'NZ', 'NZ': 'NZ', 'Pacific/Chatham': 'NZ',
  'Pacific/Fiji': 'FJ', 'Pacific/Port_Moresby': 'PG', 'Pacific/Guam': 'GU', 'Pacific/Tahiti': 'PF', 'Pacific/Noumea': 'NC', 'Pacific/Apia': 'WS',
  'Pacific/Tongatapu': 'TO',
};

/**
 * The country for an IANA time zone name such as `Europe/Berlin`, or undefined for an unknown zone,
 * a zone that spans countries (`UTC`), or anything that is not a string.
 */
export function timeZoneCountry(timeZone: unknown): string | undefined {
  if (typeof timeZone !== 'string') {
    return undefined;
  }
  return ZONE_COUNTRY[timeZone.trim()];
}
