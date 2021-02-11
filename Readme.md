# jerd

a language, I think


Features:

## Code is referenced by-hash, not by-name

- renames don't break things
- reordering args (?) um doesn't break things? (maybe need annotation on the function definition to indicate visual reordering)
- if you change a function, none of the things using it change, unless you rebase them explicitly.
- same for if you change a type

## Macros

Macros get a typed-ast, and the typing environment.
All terms are evaulated "top" to "bottom", only explicit circular dependencies for terms declared at the same time.
Including quasiquoting I think.

What things are macros? is `match` a macro?
Do macros always get a `continuation`? Or are they just allowed to `return`? .....
....
...
..
.



## Effects

Question: can I unify "effect definitions" with something else?
- record definition? not really. enum? also no
- modular implicit? 🤔 there definitely seems to be something similar here.
- but in this case the thing I'm accessing is Global
  > ok so the big deal here is ... hm so for unison, the big deal is mutation
  > because otherwise there's no mutation.
  > but I'll have single-owner mutation, right?
  > so async is the big win, I think?
  > I mean, hmmm
  > yeah if we have modular implicits too, some of the wins are less for effects.
  > but yeah, IO. so you can mock it out. especially to do the asynclyness

Ok is there another layer of "dependency injection" that I want to capture?
maybe, but I'll think about it later.





so, continuation passing style
what do handlers look like?
am I still adding something to the "global" handler stack?
seems like that wouldn't really gel.
come to think of it, the scheme version would probably
not be happy about using green-threads or whatnot.
So, I'm thinking the handlers are ... something that's passed along with context?

yeah I should definitely figure out what I want to be doing there.


So, is it easier to think of transforming to call/cc and then to cps?
or just directly?

```
const maybeThrow = (v, k) => {
    if (v) {
        raiseAbility(someAbility, k)
    } else {
        // BUT if we know for sure that doSomethingElse has no effects,
        // then we can just do `const res = doSomethingElse(4)`
        doSomethingElse(4, res => k(res))
    }
}
```

Ok yeah that wasn't so bad.
but the global stack of abilities won't play nice with javascript's asyncness.
So I think we'll want a second parameter that's passed all along,
that is the "handler stack".

```
const maybeThrow = (v, handlerStack, k) => {
    if (v) {
        raiseAbility(handlerStack, someAbility, k)
    } else {
        doSomethingElse(4, handlerStack, res => k(res))
    }
}
```

Yeah I feel like that should work?

Ok so this means that we're going to need an IR that probably loses some type definition? but we want to do something source-mappy (a DFS traversal visit ID of the node in the TypedTree that we came from, probably).

Also the handler stack, each handler will be annotated with the effects
that it can handle. and it'll get skipped if it can't.
And if none can, then we get to skip right to the builtin implementation potentially.

----

yeah ok let's see if we can get effects working

<<<<>>>><<<<>>>>


