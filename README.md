# tatabook-cipher

The **Tata cipher**, standalone: a transcript book cipher in which the ciphertext is a list of
word numbers and the book is a real recording's transcript.

> **Author:** Emmanuel Secretaria
> Transcript-anchored idea from the TIGSO project · first public edition: the Hantuchova interview.

Live: https://echo-edu-80910.web.app

## The rule

1. The book is an ordered transcript — every word keeps its token, normalized form, and the
   millisecond onset/offset where it was spoken. Its canonical word list is bound by a SHA-256 digest.
2. A word's **letter key** is the first letter of its longest letter-run, lowercased
   (`I've → ve → V`). Words with no letters are not referenceable.
3. Encode: each message letter (A–Z) takes the next unused word whose key matches, walking forward;
   a space becomes token `0`. Numbers therefore strictly increase and no word is reused.
4. Decode: look up every number, read the key, concatenate. `0` is a space.
5. Capacity is per letter: the book must start at least as many words with a letter as the message uses.
6. The book ships with the puzzle; a digest mismatch means a different edition and decoding must stop.

There is **no key and no encryption here** — the book is public. Confidentiality is not the goal;
the puzzle, the timeline carrier, and the digest-bound edition are.

## Run it

```sh
cp .env.example .env      # Firebase web config (public read-only gallery)
npm install
npm run dev               # http://localhost:5173
npm run build             # static build in dist/
```

Puzzles are read from the `edu_puzzles` collection (public read, client writes denied).
The publisher lives in the TIGSO toolchain (`educational/publish.py`) and writes with the Admin SDK.

## Included assets

- `public/books/hantuchova.json` — the transcript artifact (4,057 words + timings + digest)
- `public/books/hantuchova.html` — the numbered book, printable/readable in any browser

## Deploy

```sh
cp .firebaserc.example .firebaserc   # project id
npx firebase-tools deploy --only hosting
```

The hosting site is `echo-edu-80910` (Firebase multi-site). Change `firebase.json` to deploy elsewhere.

## Licence

MIT. The cipher *family* (book ciphers) is centuries old and public domain; this implementation,
its normalization rule, the digest-bound edition and the timeline carrier are the author's work.
