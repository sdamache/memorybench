import dedent from "dedent";

// prompt to enhance chunk with contextual retrieval (document summary)
export const contextualRetrievalPrompt = (document: string, chunk: string) => {
	return dedent`<document> 
${document}
</document> 
Here is the chunk we want to situate within the whole document 
<chunk> 
${chunk}
</chunk> 
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;
};
