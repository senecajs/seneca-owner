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
type BuildRolesOpts = {
    roles: Roles;
    fields: string[];
    ownerfield: string;
};
type BuildRolesDeps = {
    deep: (...args: any[]) => any;
    Patrun: () => any;
    error: (code: string, details?: any) => Error;
};
export declare function axisName(field: string): string;
export declare function build_roles(opts: BuildRolesOpts, deps: BuildRolesDeps): {
    [name: string]: any;
};
export {};
