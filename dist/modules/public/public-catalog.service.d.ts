import { type Kysely } from 'kysely';
import type { DB } from '../../generated/database.types.js';
type Sort = 'newest' | 'oldest' | 'year_desc' | 'year_asc' | 'mileage_asc' | 'mileage_desc';
export interface VehicleListFilters {
    market: string;
    featuredOnly?: boolean | undefined;
    q?: string | undefined;
    makeId?: number | undefined;
    modelId?: number | undefined;
    bodyTypeId?: number | undefined;
    condition?: 'new' | 'used' | undefined;
    yearMin?: number | undefined;
    yearMax?: number | undefined;
    yearFrom?: number | undefined;
    yearTo?: number | undefined;
    mileageFrom?: number | undefined;
    mileageTo?: number | undefined;
    mileageMax?: number | undefined;
    engineCcFrom?: number | undefined;
    engineCcTo?: number | undefined;
    engineCcMin?: number | undefined;
    engineCcMax?: number | undefined;
    fuel?: string[] | undefined;
    transmission?: string[] | undefined;
    drive?: string[] | undefined;
    steering?: string[] | undefined;
    seats?: number | undefined;
    doors?: number | undefined;
    exteriorColor?: string | undefined;
    interiorColor?: string | undefined;
    stockCountryId?: number | undefined;
    featureIds: number[];
    sort: Sort;
    cursor?: string | undefined;
    limit: number;
}
export declare class PublicCatalogService {
    private readonly db;
    constructor(db: Kysely<DB>);
    listMarkets(): Promise<{
        slug: string;
        currencyCode: string;
        locale: string;
        country: {
            iso2: string;
            name: string;
        };
    }[]>;
    getMarket(slug: string): Promise<{
        slug: string;
        currencyCode: string;
        locale: string;
        salesEmail: string | null;
        salesPhone: string | null;
        salesWhatsapp: string | null;
        seoTitle: string | null;
        seoDescription: string | null;
        country: {
            iso2: string;
            name: string;
        };
    }>;
    listCountries(region?: string): Promise<{
        id: number;
        iso2: string;
        iso3: string;
        name: string;
        phoneCode: string | null;
        region: string | null;
    }[]>;
    listMakes(): Promise<{
        id: number;
        name: string;
        slug: string;
        logoUrl: string | null;
    }[]>;
    listModels(makeId?: number): Promise<{
        id: number;
        makeId: number;
        name: string;
        slug: string;
    }[]>;
    listBodyTypes(): Promise<{
        id: number;
        name: string;
        slug: string;
    }[]>;
    listFeatures(): Promise<{
        id: number;
        name: string;
        category: string | null;
    }[]>;
    listPublishedVehicles(filters: VehicleListFilters): Promise<{
        data: ({
            referenceNo: string;
            title: string;
            condition: string;
            variant: string | null;
            year: number;
            mileageKm: number | null;
            engineCc: number | null;
            fuel: string | null;
            transmission: string | null;
            drive: string | null;
            steering: string | null;
            seats: number | null;
            doors: number | null;
            exteriorColor: string | null;
            interiorColor: string | null;
            stockCity: string | null;
            make: {
                id: number;
                name: string;
                slug: string;
                logoUrl: string | null;
            };
            model: {
                id: number;
                name: string;
                slug: string;
            };
            bodyType: {
                id: number;
                name: string | null;
                slug: string | null;
            } | null;
            stockCountry: {
                id: number;
                iso2: string;
                iso3: string;
                name: string;
            };
            primaryMedia: {
                id: string;
                type: string | null;
                url: string | null;
                thumbUrl: string | null;
                sortOrder: number | null;
            } | null;
        } | {
            description: string | null;
            referenceNo: string;
            title: string;
            condition: string;
            variant: string | null;
            year: number;
            mileageKm: number | null;
            engineCc: number | null;
            fuel: string | null;
            transmission: string | null;
            drive: string | null;
            steering: string | null;
            seats: number | null;
            doors: number | null;
            exteriorColor: string | null;
            interiorColor: string | null;
            stockCity: string | null;
            make: {
                id: number;
                name: string;
                slug: string;
                logoUrl: string | null;
            };
            model: {
                id: number;
                name: string;
                slug: string;
            };
            bodyType: {
                id: number;
                name: string | null;
                slug: string | null;
            } | null;
            stockCountry: {
                id: number;
                iso2: string;
                iso3: string;
                name: string;
            };
            primaryMedia: {
                id: string;
                type: string | null;
                url: string | null;
                thumbUrl: string | null;
                sortOrder: number | null;
            } | null;
        })[];
        meta: {
            limit: number;
            nextCursor: string | null;
        };
    }>;
    getPublishedVehicle(referenceNo: string, market: string): Promise<{
        media: {
            id: string;
            type: "image" | "video";
            url: string;
            thumbUrl: string | null;
            sortOrder: number;
            isPrimary: boolean;
        }[];
        features: {
            id: number;
            name: string;
            category: string | null;
        }[];
        referenceNo: string;
        title: string;
        condition: string;
        variant: string | null;
        year: number;
        mileageKm: number | null;
        engineCc: number | null;
        fuel: string | null;
        transmission: string | null;
        drive: string | null;
        steering: string | null;
        seats: number | null;
        doors: number | null;
        exteriorColor: string | null;
        interiorColor: string | null;
        stockCity: string | null;
        make: {
            id: number;
            name: string;
            slug: string;
            logoUrl: string | null;
        };
        model: {
            id: number;
            name: string;
            slug: string;
        };
        bodyType: {
            id: number;
            name: string | null;
            slug: string | null;
        } | null;
        stockCountry: {
            id: number;
            iso2: string;
            iso3: string;
            name: string;
        };
        primaryMedia: {
            id: string;
            type: string | null;
            url: string | null;
            thumbUrl: string | null;
            sortOrder: number | null;
        } | null;
    } | {
        media: {
            id: string;
            type: "image" | "video";
            url: string;
            thumbUrl: string | null;
            sortOrder: number;
            isPrimary: boolean;
        }[];
        features: {
            id: number;
            name: string;
            category: string | null;
        }[];
        description: string | null;
        referenceNo: string;
        title: string;
        condition: string;
        variant: string | null;
        year: number;
        mileageKm: number | null;
        engineCc: number | null;
        fuel: string | null;
        transmission: string | null;
        drive: string | null;
        steering: string | null;
        seats: number | null;
        doors: number | null;
        exteriorColor: string | null;
        interiorColor: string | null;
        stockCity: string | null;
        make: {
            id: number;
            name: string;
            slug: string;
            logoUrl: string | null;
        };
        model: {
            id: number;
            name: string;
            slug: string;
        };
        bodyType: {
            id: number;
            name: string | null;
            slug: string | null;
        } | null;
        stockCountry: {
            id: number;
            iso2: string;
            iso3: string;
            name: string;
        };
        primaryMedia: {
            id: string;
            type: string | null;
            url: string | null;
            thumbUrl: string | null;
            sortOrder: number | null;
        } | null;
    }>;
    private ordering;
    private cursorCondition;
    private cursorFor;
}
export {};
