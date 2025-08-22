"use strict";

import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

const Settings = {
  debug: false,
  optimizePrompt: true,
  overrideWidgetValue: true,
}

function stripComments(str) {
  return str.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
}

function getGlobalPrompts() {
  const result = {};

  // Note does not have comfyClass
  const notes = app.graph._nodes.filter((item) => 
    item.type === "Note" && 
    item.widgets[0] && 
    item.mode === 0 // disable bypass
  );

  for (const n of notes) {
    const key = n.title;
    const value = stripComments(n.widgets[0].value || "");

    if (!result[key]) {
      result[key] = [value];
    } else {
      result[key].push(value);
    }
  }

  return Object.entries(result).sort((a, b) => b[0].length - a[0].length);
}

function replaceGlobalPrompts(globalPrompts, prompt) {
  for (const [key, values] of globalPrompts) {
    prompt = prompt.replaceAll(`$${key}`, () => replaceGlobalPrompts(
      globalPrompts,
      values[Math.floor(Math.random() * values.length)] || "",
    ));
  }

  return prompt;
}

function replaceDynamicPrompts(prompt) {
  let offset = 0, 
      i = prompt.indexOf("{", offset);

  while(i > -1) {

    offset = i + 1;

    if (prompt.charAt(i - 1) !== "\\") {

      const closingIndex = prompt.indexOf("}", offset);
      if (closingIndex === -1) {
        throw new Error(`Unexpected token "{"`);
      }
  
      const nextOpeningIndex = prompt.indexOf("{", offset);

      if (nextOpeningIndex === -1 || closingIndex < nextOpeningIndex) {
        const items = prompt.substring(i + 1, closingIndex).split("|");

        // original dynamic prompt algorithm
        // const item = items[Math.floor(Math.random() * items.length)];

        const convertedItems = items.map((item) => {
          const match = item.match(/(?::(\d+(?:\.\d+)?)\s*)$/);
          if (match) {
            return {
              value: item.substring(0, item.length - match[0].length),
              weight: parseFloat(match[1]),
            }
          }

          return {
            value: item,
            weight: 1,
          }
        });

        const total = convertedItems.reduce((prev, curr) => prev + curr.weight, 0);

        let r = Math.random() * total,
            selectedItem;

        for (const item of convertedItems) {
          if (r < item.weight) {
            selectedItem = item.value;
            break;
          }
          r -= item.weight;
        }
        
        const value = selectedItem?.value || "";

        prompt = prompt.substring(0, i) + 
          value + 
          prompt.substring(closingIndex + 1);
          
        offset = 0; 
      }
    }

    i = prompt.indexOf("{", offset);
  }

  return prompt;
}

// Fix selected values via DynamicPrompt
// Synchronize workflow values with prompt(output) values
// {red|green|blue} => red
;(() => {
  const origFunc = api.queuePrompt;
  api.queuePrompt = async function(...args) {
    if (Settings["overrideWidgetValue"]) {
      const { output, workflow } = args[1];
      for (const node of app.graph.nodes) {
        if (!node.widgets) {
          continue;
        }
        for (let i = 0; i < node.widgets.length; i++) {
          const widget = node.widgets[i];
          if (!widget.dynamicPrompts) {
            continue;
          }
          const serializedValue = output[node.id]?.inputs[widget.name];
          const serializedNode = workflow.nodes.find((item) => item.id === node.id);
          if (
            serializedValue && 
            serializedNode && 
            typeof serializedNode.widgets_values[i] === typeof serializedValue
          ) {
            serializedNode.widgets_values[i] = serializedValue;
          }
        }
      }
    }

    const r =  await origFunc.call(api, ...args);

    return r;
  }
})();

app.registerExtension({
	name: "shinich39.GlobalPrompt",
  settings: [
    {
      id: 'shinich39.GlobalPrompt.Debug',
      category: ['GlobalPrompt', 'NO MORE THINKING', 'Debug'],
      name: 'Debug',
      tooltip: 'Write prompts in the browser console for debug.',
      type: 'boolean',
      defaultValue: Settings.debug,
      onChange: (value) => {
        Settings["debug"] = value;
      }
    },
    {
      id: 'shinich39.GlobalPrompt.OptimizePrompt',
      category: ['GlobalPrompt', 'NO MORE THINKING', 'OptimizePrompt'],
      name: 'Optimize Prompt',
      tooltip: 'Remove empty tokens and multiple whitespaces before generation.',
      type: 'boolean',
      defaultValue: Settings.optimizePrompt,
      onChange: (value) => {
        Settings["optimizePrompt"] = value;
      }
    },
    {
      id: 'shinich39.GlobalPrompt.OverrideWidgetValue',
      category: ['GlobalPrompt', 'NO MORE THINKING', 'OverrideWidgetValue'],
      name: 'Override Widget Value',
      tooltip: 'Override the selected value to workflow widget of generated image.',
      type: 'boolean',
      defaultValue: Settings.overrideWidgetValue,
      onChange: (value) => {
        Settings["overrideWidgetValue"] = value;
      }
    },
  ],
  nodeCreated(node) {
		if (node.widgets) {
			// Locate dynamic prompt text widgets
			// Include any widgets with dynamicPrompts set to true, and customtext
			const widgets = node.widgets.filter(
				(n) => n.dynamicPrompts
			);
			for (const widget of widgets) {
				// Override the serialization of the value to resolve dynamic prompts for all widgets supporting it in this node
        // const origSerializeValue = widget.serializeValue;
        widget.serializeValue = async function(workflowNode, widgetIndex) {
          // ignore original dynamicPrompts: ComfyUI_frontend/src/extensions/core/dynamicPrompts.ts
          // let r = await origSerializeValue?.apply(this, arguments) ?? widget.value;
          let r = widget.value;

          // Bugfix: this extension has been overwrite the original dynamicPrompt (Custom-Script presetText.js)
          r = stripComments(r);

          // Convert $name to Note.text
          const gp = getGlobalPrompts();
          r = replaceGlobalPrompts(gp, r);

          try {
            r = replaceDynamicPrompts(r);
          } catch(err) {
            console.error(`[comfyui-global-prompts][#${node.id}] ${err.message}\n${r}`);
          }

          // Remove unused blanks, commas
          if (Settings["optimizePrompt"]) {
            r = r.replace(/[\r\n]/g, ",").replace(/[,\s]*,+[,\s]*/g, ", ");
          }

          // Overwrite the value in the serialized workflow pnginfo
          if (workflowNode?.widgets_values) {
            workflowNode.widgets_values[widgetIndex] = r;
          }

          if (Settings["debug"]) {
            console.log(`[comfyui-global-prompts][#${node.id}]\n${r}`);
          }

          return r;
        }
			}
		}
	},
});