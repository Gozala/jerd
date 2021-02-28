import {
    Term,
    Env,
    Type,
    getEffects,
    Symbol,
    Id,
    Reference,
    Let,
    Var,
} from './types';
import { Location } from './parser';
import * as t from '@babel/types';
import generate from '@babel/generator';
import traverse from '@babel/traverse';
import { binOps } from './preset';
import { env } from 'process';
import { showType } from './unify';
import { optimizeAST } from './typeScriptOptimize';

const printSym = (sym: Symbol) => sym.name + '_' + sym.unique;
const printId = (id: Id) => 'hash_' + id.hash; // + '_' + id.pos; TODO recursives

// export const comment = (node: t.Node, text: string) => t.addComment()

function withLocation<
    T extends { start: number | null; end: number | null; loc: any }
>(v: T, loc: Location | null): T {
    if (loc == null) {
        return v;
    }
    v.start = loc.start.offset;
    v.end = loc.end.offset;
    v.loc = { start: loc.start, end: loc.end };
    return v;
}

export const termToString = (env: Env, term: Term): string => {
    // const ast = printTerm(env, term)
    // return generate(ast).code;

    const ast = t.file(
        t.program([t.expressionStatement(printTerm(env, term))], [], 'script'),
    );
    optimizeAST(ast);
    return generate(ast).code;
};

export const printType = (env: Env, type: Type): string => {
    switch (type.type) {
        case 'ref':
            if (type.ref.type === 'builtin') {
                return type.ref.name === 'int' ? 'number' : type.ref.name;
            } else {
                return type.ref.id.hash;
            }
        case 'lambda': {
            let args = type.args.map((t) => printType(env, t)).join(', ');
            if (type.rest) {
                args += ', ...' + printType(env, type.rest);
            }
            const effects = type.effects
                .map((t) => printType(env, t))
                .join(', ');
            return `(${args}) =${
                effects ? '(' + effects + ')' : ''
            }> ${printType(env, type.res)}`;
        }
        case 'var':
            return `type-var-${type.sym.name}`;
        default:
            throw new Error(`Cannot print`);
    }
};

export const typeToString = (env: Env, type: Type): string => {
    return generate(typeToAst(env, type)).code;
};

export const typeToAst = (env: Env, type: Type): t.TSType => {
    switch (type.type) {
        case 'ref':
            if (type.ref.type === 'builtin') {
                return t.tsTypeReference(
                    t.identifier(
                        type.ref.name === 'int' ? 'number' : type.ref.name,
                    ),
                );
            } else {
                return t.tsTypeReference(t.identifier('t_' + type.ref.id.hash));
            }
        case 'var':
            return t.tsTypeReference(t.identifier(`T_${type.sym.unique}`));
        case 'lambda': {
            const res = t.tsTypeAnnotation(typeToAst(env, type.res));

            const findTypeVariables = (type: Type): Array<Symbol> => {
                switch (type.type) {
                    case 'var':
                        return [type.sym];
                    case 'ref':
                        return [];
                    case 'lambda':
                        return ([] as Array<Symbol>)
                            .concat(...type.args.map(findTypeVariables))
                            .concat(findTypeVariables(type.res));
                    default:
                        return [];
                }
            };

            // const vbls = dedup(findTypeVariables(type).map((m) => `${m.name}`));
            // hrmmm a function type should really keep track of its own type variables.
            // like, explicitly.
            // so that we know the difference between
            // <T, R>(x: T, () => R) => T
            // and
            // <T>(x: T, <R>() => R) => T

            return t.tsFunctionType(
                type.typeVbls.length
                    ? t.tsTypeParameterDeclaration(
                          type.typeVbls.map((name) =>
                              t.tsTypeParameter(null, null, `T_${name}`),
                          ),
                      )
                    : null,
                type.args
                    .map((arg, i) => ({
                        ...t.identifier('arg_' + i),
                        typeAnnotation: t.tsTypeAnnotation(typeToAst(env, arg)),
                    }))
                    .concat(
                        type.effects.length
                            ? [
                                  {
                                      ...t.identifier('handlers'),
                                      typeAnnotation: t.tsTypeAnnotation(
                                          t.tsAnyKeyword(),
                                      ),
                                  },
                                  {
                                      ...t.identifier('done'),
                                      typeAnnotation: t.tsTypeAnnotation(
                                          t.tsFunctionType(
                                              null,
                                              [
                                                  {
                                                      ...t.identifier('result'),
                                                      typeAnnotation: res,
                                                  },
                                              ],
                                              t.tsTypeAnnotation(
                                                  t.tsVoidKeyword(),
                                              ),
                                          ),
                                      ),
                                      //   typeToAst(env, {
                                      //       type: 'lambda',
                                      //       args: [res]
                                      //   })
                                      /*t.tsTypeAnnotation(
                                          t.tsAnyKeyword(),
                                      )*/
                                  },
                              ]
                            : [],
                    ),
                type.effects.length
                    ? t.tsTypeAnnotation(t.tsVoidKeyword())
                    : res,
            );
        }
    }
};

// // use an IIFE to bind. There are much smarter ways.
// const bind = (
//     id: t.Identifier,
//     v: t.Expression,
//     body: t.Expression,
// ): t.Expression => {
//     return t.callExpression(t.arrowFunctionExpression([id], body), [v]);
// };

export const printLambdaBody = (
    env: Env,
    term: Term,
    // cps: null | { body: t.Expression; bind: t.Identifier },
    cps: null | t.Expression,
): t.BlockStatement | t.Expression => {
    if (cps == null) {
        if (term.type === 'sequence') {
            return withLocation(
                t.blockStatement(
                    term.sts.map((s, i) =>
                        withLocation(
                            s.type === 'Let'
                                ? t.variableDeclaration('const', [
                                      t.variableDeclarator(
                                          t.identifier(printSym(s.binding)),
                                          printTerm(env, s.value),
                                      ),
                                  ])
                                : i === term.sts.length - 1
                                ? t.returnStatement(printTerm(env, s))
                                : t.expressionStatement(printTerm(env, s)),
                            s.location,
                        ),
                    ),
                ),
                term.location,
            );
        } else {
            return printTerm(env, term);
        }
    } else {
        // return t.identifier('cps');
        if (term.type === 'sequence') {
            // so we start from the last
            // and we know what we want to bind to, right? or something?
            // in what case would we want to CPS something that
            // can't be CPSd?
            // const last = term.sts[term.sts.length - 1];
            let inner = cps;
            for (let i = term.sts.length - 1; i >= 0; i--) {
                if (i > 0) {
                    inner = t.arrowFunctionExpression(
                        [t.identifier('handlers'), t.identifier('_ignored')],
                        withLocation(
                            t.blockStatement([
                                withLocation(
                                    t.expressionStatement(
                                        termToAstCPS(env, term.sts[i], inner),
                                    ),
                                    term.sts[i].location,
                                ),
                            ]),
                            term.sts[i].location,
                        ),
                    );
                } else {
                    inner = termToAstCPS(env, term.sts[i], inner);
                }
            }
            return t.blockStatement([t.expressionStatement(inner)]);
            // let pre = [];
            // for (let s of term.sts) {
            //     if (getEffects(s).length === 0) {
            //         console.log('ok', s);
            //         pre.push(t.expressionStatement(printTerm(env, s)));
            //     } else {
            //         pre.push(t.expressionStatement(termToAstCPS(env, s, cps)));
            //     }
            // }
            // return t.blockStatement(pre);
        } else {
            return t.blockStatement([
                t.expressionStatement(termToAstCPS(env, term, cps)),
            ]);
        }
        // return t.identifier(term.type);
    }
};

export const termToAST = (
    env: Env,
    term: Term,
    comment?: string,
): t.Statement => {
    let res = withLocation(
        t.expressionStatement(printTerm(env, term)),
        term.location,
    );
    if (comment) {
        res = t.addComment(res, 'leading', comment);
    }
    return res;
};

export const declarationToAST = (
    env: Env,
    hash: string,
    term: Term,
    comment?: string,
): t.VariableDeclaration => {
    let res = t.variableDeclaration('const', [
        t.variableDeclarator(
            {
                ...t.identifier('hash_' + hash),
                typeAnnotation: t.tsTypeAnnotation(typeToAst(env, term.is)),
            },
            printTerm(env, term),
        ),
    ]);
    if (comment) {
        res = t.addComment(res, 'leading', comment);
    }
    return res;
};

// export const generateFile

export const declarationToString = (
    env: Env,
    hash: string,
    term: Term,
): string => {
    const ast = t.file(
        t.program([declarationToAST(env, hash, term)], [], 'script'),
    );
    optimizeAST(ast);
    return generate(ast).code;
};

const isSimple = (arg: Term) => {
    switch (arg.type) {
        case 'int':
        case 'string':
        case 'ref':
        case 'var':
            return true;
        default:
            if (
                arg.type === 'apply' &&
                arg.args.every(isSimple) &&
                arg.target.type === 'ref' &&
                arg.target.ref.type === 'builtin' &&
                isSimpleBuiltin(arg.target.ref.name)
            ) {
                return true;
            }
            return false;
    }
};

const isSimpleBuiltin = (name: string) => {
    return binOps.includes(name);
};

export const termToAstCPS = (
    env: Env,
    term: Term | Let,
    done: t.Expression,
): t.Expression => {
    return withLocation(_termToAstCPS(env, term, done), term.location);
};

// cps: t.Identifier // is it the done fn, or the thing I want you to bind to?
const _termToAstCPS = (
    env: Env,
    term: Term | Let,
    done: t.Expression,
): t.Expression => {
    if (!getEffects(term).length && term.type !== 'Let') {
        return t.callExpression(done, [
            t.identifier('handlers'),
            printTerm(env, term),
        ]);
    }
    switch (term.type) {
        case 'handle': {
            if (getEffects(term.target).length > 0) {
                throw new Error(
                    `Handle target has effects! should be a lambda`,
                );
            }
            return t.callExpression(t.identifier('handleSimpleShallow2'), [
                t.stringLiteral(printRef(term.effect)),
                printTerm(env, term.target),
                t.arrayExpression(
                    term.cases
                        .sort((a, b) => a.constr - b.constr)
                        .map(({ args, k, body }) => {
                            return t.arrowFunctionExpression(
                                [
                                    t.identifier('handlers'),
                                    args.length === 0
                                        ? t.identifier('_')
                                        : args.length === 1
                                        ? t.identifier(printSym(args[0]))
                                        : t.arrayPattern(
                                              args.map((s) =>
                                                  t.identifier(printSym(s)),
                                              ),
                                          ),
                                    t.identifier(printSym(k)),
                                ],
                                printLambdaBody(env, body, done),
                            );
                        }),
                ),
                t.arrowFunctionExpression(
                    [
                        t.identifier('handlers'),
                        t.identifier(printSym(term.pure.arg)),
                    ],
                    printLambdaBody(env, term.pure.body, done),
                ),
                t.identifier('handlers'),
            ]);
        }
        case 'Let': {
            return termToAstCPS(
                env,
                term.value,
                t.arrowFunctionExpression(
                    [
                        t.identifier('handlers'),
                        t.identifier(printSym(term.binding)),
                    ],
                    t.callExpression(done, [t.identifier('handlers')]),
                    // t.blockStatement([t.expressionStatement(inner)]),
                ),
            );
        }
        case 'raise': {
            if (term.argsEffects.length > 0) {
                return t.identifier('raise args effects');
            }
            if (term.ref.type === 'builtin') {
                throw new Error('ok');
            }
            const args: Array<t.Expression> = [
                t.identifier('handlers'),
                t.stringLiteral(term.ref.id.hash),
                t.numericLiteral(term.idx),
            ];
            if (term.args.length === 0) {
                args.push(t.nullLiteral());
            } else if (term.args.length === 1) {
                args.push(printTerm(env, term.args[0]));
            } else {
                args.push(
                    t.arrayExpression(term.args.map((a) => printTerm(env, a))),
                );
            }
            args.push(
                t.arrowFunctionExpression(
                    [t.identifier('handlers'), t.identifier('value')],
                    t.callExpression(done, [
                        t.identifier('handlers'),
                        t.identifier('value'),
                    ]),
                ),
            );
            return t.callExpression(t.identifier('raise'), args);
        }
        case 'if': {
            const condEffects = getEffects(term.cond);
            if (condEffects.length) {
                return termToAstCPS(
                    env,
                    term.cond,
                    t.arrowFunctionExpression(
                        [t.identifier('handlers'), t.identifier(`cond`)],
                        t.blockStatement([
                            t.ifStatement(
                                t.identifier('cond'),
                                ifBlock(printLambdaBody(env, term.yes, done)),
                                ifBlock(
                                    term.no
                                        ? printLambdaBody(env, term.no, done)
                                        : t.callExpression(done, [
                                              t.identifier('handlers'),
                                          ]),
                                ), // void
                            ),
                        ]),
                    ),
                );
            }

            const cond = printTerm(env, term.cond);

            return iffe(
                t.blockStatement([
                    t.ifStatement(
                        cond,
                        ifBlock(printLambdaBody(env, term.yes, done)),
                        ifBlock(
                            term.no
                                ? printLambdaBody(env, term.no, done)
                                : t.callExpression(done, [
                                      t.identifier('handlers'),
                                  ]),
                        ), // void
                    ),
                ]),
            );
        }
        case 'apply': {
            if (getEffects(term.target).length) {
                return t.identifier('target effects');
            }
            const u = env.local.unique++;

            const argTypes =
                term.target.is.type === 'lambda' ? term.target.is.args : null;
            if (argTypes === null) {
                throw new Error(`Need to resolve target type`);
            }
            const args = term.args.map((arg, i) => {
                return maybeWrapPureFunction(env, arg, argTypes[i]);
            });

            if (term.argsEffects.length > 0) {
                const target = printTerm(env, term.target);
                let inner: t.Expression = done;
                if (term.effects.length > 0) {
                    // ok so the thing is,
                    // i only need to cps it out if the arg
                    // is an apply that does cps.
                    // but not if that arg has an arg that does cps,
                    // right?
                    inner = callOrBinop(
                        target,
                        args
                            .map((arg, i) =>
                                isSimple(arg)
                                    ? printTerm(env, arg)
                                    : t.identifier(`arg_${i}_${u}`),
                            )
                            .concat([t.identifier('handlers'), inner as any]),
                    );
                } else {
                    // hm. I feel like I need to introspect `done`.
                    // and have a way to flatten out immediate calls.
                    // or I could do that post-hoc?
                    // I mean that might make things simpler tbh.
                    inner = t.callExpression(done, [
                        t.identifier('handlers'),
                        // so here is where we want to
                        // put the "body"
                        // which might include inverting it.
                        callOrBinop(
                            target,
                            args.map((arg, i) =>
                                isSimple(arg)
                                    ? printTerm(env, arg)
                                    : t.identifier(`arg_${i}_${u}`),
                            ),
                        ),
                    ]);
                }
                for (let i = args.length - 1; i >= 0; i--) {
                    if (isSimple(args[i])) {
                        continue;
                    }
                    // TODO: follow type refs 🤔
                    // should just have a function like
                    // `resolveType(env, theType)`
                    // if (term.target.is.type === 'lambda' && )
                    inner = termToAstCPS(
                        env,
                        args[i],
                        t.arrowFunctionExpression(
                            [
                                t.identifier('handlers'),
                                t.identifier(`arg_${i}_${u}`),
                            ],
                            t.blockStatement([t.expressionStatement(inner)]),
                        ),
                    );
                }
                return inner;
                // return termToAstCPS(
                //     env,
                //     args[0],
                //     t.arrowFunctionExpression([t.identifier('value')], inner),
                // );
                // return t.identifier('args effects');
            }
            const target = printTerm(env, term.target);
            return callOrBinop(
                target,
                args
                    .map((arg) => printTerm(env, arg))
                    .concat([t.identifier('handlers'), done]),
            );
        }
        case 'sequence':
            throw new Error(
                `Sequence encountered. This should probably be a lambda body?`,
            );
        default:
            console.log('ELSE', term.type);
            return t.callExpression(done, [
                t.identifier('handlers'),
                printTerm(env, term),
            ]);
    }
};

const maybeWrapPureFunction = (env: Env, arg: Term, t: Type): Term => {
    // console.error(`Maybe ${showType(arg.is)} : ${showType(t)}`);
    if (t.type !== 'lambda' || t.effects.length === 0) {
        return arg;
    }
    if (arg.is.type !== 'lambda') {
        throw new Error(
            `arg not a lambda, would be cool to statically keep these in sync`,
        );
    }
    if (arg.is.effects.length !== 0) {
        return arg;
    }
    const args: Array<Var> = arg.is.args.map((t, i) => ({
        type: 'var',
        is: t,
        location: null,
        sym: {
            unique: env.local.unique++,
            name: `arg_${i}`,
        },
    }));
    return {
        type: 'lambda',
        args: args.map((a) => a.sym),
        is: {
            ...arg.is,
            effects: t.effects,
        },
        location: arg.location,
        body: {
            type: 'apply',
            location: arg.location,
            args,
            target: arg,
            argsEffects: [],
            effects: [],
            is: arg.is.res,
        },
        // effects: t.effects,
    };
};

const callOrBinop = (target: t.Expression, args: Array<t.Expression>) => {
    if (t.isIdentifier(target) && binOps.includes(target.name)) {
        return t.binaryExpression(
            (target.name === '++' ? '+' : target.name) as any,
            args[0],
            args[1],
        );
    }
    return t.callExpression(target, args);
};

const ifBlock = (x: t.BlockStatement | t.Expression): t.BlockStatement => {
    if (x.type === 'BlockStatement') {
        return x;
    } else {
        return t.blockStatement([t.returnStatement(x)]);
    }
};

const iffe = (st: t.BlockStatement): t.Expression => {
    return t.callExpression(t.arrowFunctionExpression([], st), []);
};

export const printTerm = (env: Env, term: Term): t.Expression => {
    return withLocation(_printTerm(env, term), term.location);
};

const _printTerm = (env: Env, term: Term): t.Expression => {
    switch (term.type) {
        // these will never need effects, immediate is fine
        case 'self':
            return t.identifier(`hash_${env.local.self.name}`);
        case 'int':
            return t.numericLiteral(term.value);
        case 'ref':
            if (term.ref.type === 'builtin') {
                return {
                    ...t.identifier(term.ref.name),
                    typeAnnotation: t.tsTypeAnnotation(typeToAst(env, term.is)),
                };
            } else {
                return t.identifier(printId(term.ref.id));
            }
        case 'if': {
            return iffe(
                t.blockStatement([
                    t.ifStatement(
                        printTerm(env, term.cond),
                        ifBlock(printTerm(env, term.yes)),
                        term.no ? ifBlock(printTerm(env, term.no)) : null,
                    ),
                ]),
            );
        }
        case 'string':
            return t.stringLiteral(term.text);
        // a lambda, I guess also doesn't need cps, but internally it does.
        case 'lambda':
            // this doesn't use effects, but it might nee
            if (term.is.effects.length > 0) {
                return t.arrowFunctionExpression(
                    term.args
                        .map((arg, i) => ({
                            ...t.identifier(printSym(arg)),
                            typeAnnotation: t.tsTypeAnnotation(
                                typeToAst(env, term.is.args[i]),
                            ),
                        }))
                        // .map((arg) => t.identifier(printSym(arg)))
                        .concat([
                            {
                                ...t.identifier('handlers'),
                                typeAnnotation: t.tsTypeAnnotation(
                                    // STOPSHIP: Actually type this
                                    t.tsAnyKeyword(),
                                ),
                            },
                            {
                                ...t.identifier('done'),
                                typeAnnotation: t.tsTypeAnnotation(
                                    typeToAst(env, {
                                        type: 'lambda',
                                        args: [term.is.res],
                                        typeVbls: [],
                                        effectVbls: [],
                                        effects: [],
                                        rest: null,
                                        location: null,
                                        res: {
                                            location: null,
                                            type: 'ref',
                                            ref: {
                                                type: 'builtin',
                                                name: 'void',
                                            },
                                        },
                                    }),
                                ),
                            },
                        ]),
                    printLambdaBody(env, term.body, t.identifier('done')),
                );
            } else {
                return t.arrowFunctionExpression(
                    term.args.map((arg) => t.identifier(printSym(arg))),
                    printLambdaBody(env, term.body, null),
                );
            }
        case 'var':
            return t.identifier(printSym(term.sym));
        case 'apply': {
            // TODO we should hang onto the arg names of the function we
            // are calling so we can use them when assigning to values.
            // oh ok so we need to do somethign else if any of the arguments
            // need CPS.

            if (term.argsEffects.length || term.effects.length) {
                throw new Error(
                    `This apply has effects, but isn't in a CPS context.`,
                );
            }

            // Pure, love it.
            const target = printTerm(env, term.target);

            const argTypes =
                term.target.is.type === 'lambda' ? term.target.is.args : [];
            if (argTypes.length !== term.args.length) {
                throw new Error(
                    `Need to resolve target type: ${showType(
                        term.target.is,
                    )} - ${showType(term.is)}`,
                );
            }
            const args = term.args.map((arg, i) => {
                return maybeWrapPureFunction(env, arg, argTypes[i]);
            });

            return callOrBinop(
                target,
                args.map((arg) => printTerm(env, arg)),
            );
        }

        case 'raise':
            return t.identifier(
                "Cannot print a 'raise' outside of CPS. Effect tracking must have messed up.",
            );

        case 'handle': {
            const u = env.local.unique++;
            const vname = `handle_ret_${u}`;
            return iffe(
                t.blockStatement([
                    t.variableDeclaration('let', [
                        t.variableDeclarator(t.identifier(vname)),
                    ]),
                    t.expressionStatement(
                        t.callExpression(t.identifier('handleSimpleShallow2'), [
                            t.stringLiteral(printRef(term.effect)),
                            printTerm(env, term.target),
                            t.arrayExpression(
                                term.cases
                                    .sort((a, b) => a.constr - b.constr)
                                    .map(({ args, k, body }) => {
                                        return t.arrowFunctionExpression(
                                            [
                                                t.identifier('handlers'),
                                                args.length === 0
                                                    ? t.identifier('_')
                                                    : args.length === 1
                                                    ? t.identifier(
                                                          printSym(args[0]),
                                                      )
                                                    : t.arrayPattern(
                                                          args.map((s) =>
                                                              t.identifier(
                                                                  printSym(s),
                                                              ),
                                                          ),
                                                      ),
                                                t.identifier(printSym(k)),
                                            ],
                                            t.blockStatement([
                                                t.expressionStatement(
                                                    t.assignmentExpression(
                                                        '=',
                                                        t.identifier(vname),
                                                        printTerm(env, body),
                                                    ),
                                                ),
                                            ]),
                                        );
                                    }),
                            ),
                            t.arrowFunctionExpression(
                                [
                                    t.identifier('handlers'),
                                    t.identifier(printSym(term.pure.arg)),
                                ],
                                t.blockStatement([
                                    t.expressionStatement(
                                        t.assignmentExpression(
                                            '=',
                                            t.identifier(vname),
                                            printTerm(env, term.pure.body),
                                        ),
                                    ),
                                ]),
                            ),
                        ]),
                    ),
                    t.returnStatement(t.identifier(vname)),
                ]),
            );
        }

        case 'sequence': {
            // IIFE
            return t.callExpression(
                t.arrowFunctionExpression(
                    [],
                    t.blockStatement(
                        term.sts.map((s, i) =>
                            s.type === 'Let'
                                ? t.variableDeclaration('const', [
                                      t.variableDeclarator(
                                          t.identifier(printSym(s.binding)),
                                          printTerm(env, s.value),
                                      ),
                                  ])
                                : i === term.sts.length - 1
                                ? t.returnStatement(printTerm(env, s))
                                : t.expressionStatement(printTerm(env, s)),
                        ),
                    ),
                ),
                [],
            );
        }
        default:
            let _x: never = term;
            throw new Error(`Cannot print ${(term as any).type}`);
    }
};

const printRef = (ref: Reference) =>
    ref.type === 'builtin' ? ref.name : ref.id.hash;

const dedup = (items: Array<string>): Array<string> => {
    const used: { [key: string]: boolean } = {};
    return items.filter((r) => (used[r] ? false : ((used[r] = true), true)));
};
