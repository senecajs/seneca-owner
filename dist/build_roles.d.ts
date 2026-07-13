type Grant = {
    entity: string;
    ops?: string[];
    spec?: any;
};
type Role = {
    scope?: string;
    inherits?: any;
    grants?: Grant[];
};
type Roles = {
    [name: string]: Role;
};
type RolePatrun = {
    find: (pat: {
        base?: string;
        name?: string;
    }) => {
        ops: Set<string>;
        spec: any;
    } | null;
};
type CompiledRoles = {
    [name: string]: RolePatrun;
};
type BuildRolesOptions = {
    roles: Roles;
    fields: string[];
    ownerfield: string;
};
type BuildRolesUtils = {
    deep: (...args: any[]) => any;
    Patrun: () => any;
    error: (code: string, details?: any) => Error;
};
export declare function axisName(field: string): string;
export declare function build_roles(options: BuildRolesOptions, utils: BuildRolesUtils): CompiledRoles;
export {};
