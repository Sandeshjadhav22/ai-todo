import { db } from "./db";
import { todosTable } from "./db/schema";
import { eq, ilike } from "drizzle-orm";
import readlineSync from "readline-sync";
// import { GoogleGenerativeAI } from "@google/generative-ai";
// const genAI = new GoogleGenerativeAI("GEMINI_API_KEY");

async function getAllTodos() {
  const todos = await db.select().from(todosTable);
  return todos;
}

async function createTodo(todo) {
  const [result] = await db
    .insert(todosTable)
    .values({
      todo,
    })
    .returning({
      id: todosTable.id,
    });
  return result.id;
}

async function deleteById(id) {
  await db.delete(todosTable).where(eq(todosTable.id, id));
}

async function searchTodo(search) {
  const todos = await db
    .select()
    .from(todosTable)
    .where(ilike(todosTable.todo, search));
  return todos;
}

const tools = {
  getAllTodos: getAllTodos,
  createTodo: createTodo,
  deleteById,
  deleteById,
  searchTodo,
  searchTodo,
};

const SYSTEM_PROMPT = `
You are an AI TO-Do List Assistant with START, PLAN, ACTION, Observation and Output State.
wait for the user prompt and first PLAN using available tools.
After Planning, Take the action with appropriate tools and wait for Observation based on Action.
Once you get the observation, Return the AI response based on START prompt and observations 

You can manage tasks by adding, viewing, updating and deleting
You must strictly follow the JSON output formate.

Todo DB Schema:
id: Int and Primary Key 
todo: String
created_at: Date Time
updated_at: Date Time

Available Tools:
- getAllTodos(): Returns all the todos from the Databse
- createTodo(todo: string): Creates a new Todo in the DB and takes todo as a string and returns the ID of created todo
- deleteById(id: string): Deletes the todo by ID given in the DB
- searchTodo(query: string): Searches for all todos matching the query string using ilike operator

Example:
{"type": "user", "user" : "Add a task for shopping groceries."}
{"type": "plan", "plan" : "I will try to get more context on what user needs to shop."}
{"type": "output", "output" : "Can you tell me what all items you want to shop for? ."}
{"type": "user", "user" : "I want ot shop for Milk, Kurkure, layes and Choco."}
{"type": "plan", "plan" : "I will use createTodo to create a new Todo in DB."}
{"type": "action", "function" : "createTodo", "input": "shopping for milk, kurkure, layes and Choco."}
{"type": "observation", "observation" : "2"}
{"type": "output", "output" : "Your todo has been added succesfully"}
`;

const messages = [{ role: "system", content: SYSTEM_PROMPT }];
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

while (true) {
  const query = readlineSync.question(">> ");
  const userMessage = {
    type: "user",
    user: query,
  };
  messages.push({ role: "user", content: JSON.stringify(userMessage) });

  while (true) {
    const chat = await client.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      response_formate: { type: "json_object" },
    });
    const result = chat.choices[0].message.content;
    messages.push({ role: "assistant", content: result });

    const action = JSON.parse(result);

    if (action.type == "output") {
      console.log(`🤖: ${action.output}`);
      break;
    } else if (action.type == "action") {
      const fn = tools[action.function];
      if (!fn) throw new Error("Invalid tool call");

      const observation = await fn(action.input);
      const observationMessage = {
        type: "observation",
        observation: observation,
      };
      messages.push({
        role: "developer",
        content: JSON.stringify(observationMessage),
      });
    }
  }
}
