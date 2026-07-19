export default {
  async buildSubmit() {
    return {
      method: "POST",
      url: "https://relay.example.com/v1/jobs",
      body: {
        environmentIsEmpty: typeof process === "undefined",
        fileBlocked: typeof require === "undefined",
        networkBlocked: typeof fetch === "undefined"
      }
    };
  }
};
