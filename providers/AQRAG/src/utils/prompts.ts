import dedent from "dedent";

// prompt to enhance chunk with contextual retrieval (document summary) and generate questions
export const contextualRetrievalWithQuestionsPrompt = (
	document: string,
	chunk: string,
	numberOfQuestionsPerChunk: number,
) => {
	return dedent`<document>
        ${document}
        </document>
        Here is the chunk we want to situate within the whole document
        <chunk>
        ${chunk}
        </chunk>
        Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.

        Additionally, please generate questions that can be answered using the information in the chunk.

        Example:
        Given a chunk "04/22/2005 3:00 PM: Soham was born in Amravati, India."

        You may generate specific questions like:
        - When was Soham born?
        - Where was Soham born?

        Note: the above example is a illustration of how to generate questions from a chunk. Actual chunks will be much larger.

        In general, generate about ${numberOfQuestionsPerChunk} questions for the chunk.
`;
};
