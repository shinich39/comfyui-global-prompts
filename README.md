# comfyui-global-prompts

Set global prompts using note node.

## Usage  

1. Create Note node.

2. Change the note node name to whatever you want.

3. Use prompt to "$ + NOTE_NAME" in textarea.

If there are multiple note nodes with the same name, one is choosen randomly.

You can nest multiple note nodes.

e.g., 

CLIP Text Encoder: $NoteA  
NoteA: {$NoteB|$NoteC}  
NoteB: {red|green|blue}  
NoteB: white  
NoteB: black  
NoteC: No color  

Bypass note node to disable.  

### Nested dynamic prompt

This extension override original dynamic prompt.

e.g., 

{a|b|{c|d}}

a: 33%  
b: 33%  
c: 16%  
d: 16%  

### Weight

default weight is 1

{a:9|b}

a: 90%  
b: 10%  