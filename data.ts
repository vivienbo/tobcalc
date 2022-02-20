import { SecurityType, CurrencyCode, Security } from "./enums.ts";

interface ECBTimePeriod {
    id: string;
    name: string;
    start: string;
    end: string;
}

export function formatDate(date: Date): string {
    const addZero = (num: number): string => {
        return num < 10 ? `0${num}` : `${num}`;
    };
    return `${date.getFullYear()}-${addZero(date.getMonth() + 1)}-${addZero(date.getDate())}`;
}

export type ExchangeRatesMap = Map<CurrencyCode, Map<string, number>>;
export const exchangeRatesMap: ExchangeRatesMap = new Map();

// Returns a two-dimensional `Map` where each key in the first dimension is a currency code
// and each key in the second dimension being a date formatted in YYYY-MM-DD and finally, the value of each entry in
// the second dimension being the exchange rate
export async function cacheExchangeRates(start: Date, end: Date, currencyCode: CurrencyCode) {
    // See https://sdw-wsrest.ecb.europa.eu/help/

    const startPeriod = formatDate(start);
    const endPeriod = formatDate(end);
    const params = {
        startPeriod,
        endPeriod,
        format: "jsondata",
        detail: "dataonly",
        dimensionAtObservation: "AllDimensions",
    };
    const urlParamsString = new URLSearchParams(params).toString();

    const response = await fetch(`https://sdw-wsrest.ecb.europa.eu/service/data/EXR/D.${currencyCode}.EUR.SP00.A?${urlParamsString}`);
    if(response.status !== 200) {
        throw new Error(`response from ECB RESTful API returned status code ${response.status}`);
    }
    const json = await response.json();

    let foundTimePeriods = false;
    let timePeriods: ECBTimePeriod[] = [];
    for(const observation of json.structure.dimensions.observation) {
        if(observation.id === "TIME_PERIOD") {
            timePeriods = observation.values;
            foundTimePeriods = true;
            break;
        }
    }
    if(!foundTimePeriods) {
        throw new Error(`could not find time periods for start date ${startPeriod}, end date ${endPeriod} and currencyCodes ${currencyCode}`);
    }

    let currencyMap = exchangeRatesMap.get(currencyCode);
    if(currencyMap === undefined) {
        currencyMap = new Map();
        exchangeRatesMap.set(currencyCode, currencyMap);
    }
    for(let i = 0; i < timePeriods.length; i++) {
        const date = timePeriods[i].name;
        const exchangeRate = <number> json.dataSets[0].observations[`0:0:0:0:0:${i}`];
        currencyMap.set(date, exchangeRate);
    }
}

const isinsMap: Map<string, Security> = new Map();
// Returns a `Map` where each ISIN from `isins` maps to a `SecurityType`
export async function getSecurity(isin: string): Promise<Security> {
    let security = isinsMap.get(isin);
    if(security !== undefined) {
        return security;
    }

    const response = await fetch("https://www.investing.com/search/service/searchTopBar", {
        headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `search_text=${isin}`,
        method: "POST",
    });
    if(response.status !== 200) {
        throw new Error(`response from investing.com returned status code ${response.status} while searching for ISIN ${isin}`);
    }
    const json = await response.json();
    if(json.quotes !== undefined && json.quotes.length > 0) {
        const pairType = json.quotes[0].pair_type;
        switch(pairType) {
            case "etf":
                const securityDataResponse = await fetch(`https://investing.com${json.quotes[0].link}`);
                const html = await securityDataResponse.text();
                const accumulating = /<span class="float_lang_base_1">Dividend\sYield<\/span><span class="float_lang_base_2 bold">N\/A<\/span>/g.test(html);
                security = {
                    type: SecurityType.ETF,
                    accumulating,
                }
                break;
            case "equities":
                security = {
                    type: SecurityType.Stock,
                };
                break;
        }
    } else {
        throw new Error(`could not find security type for ISIN ${isin}`);
    }
    if(security === undefined) {
        throw new Error(`could not recognise security type for ISIN ${isin}`);
    }
    isinsMap.set(isin, security);
    return security;
}
