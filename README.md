# Mayhem for Code GitHub Action

[![Mayhem for Code](https://drive.google.com/uc?export=view&id=1JXEbfCDMMwwnDaOgs5-XlPWQwZR93fv4)](http://mayhem.forallsecure.com/)

A GitHub Action for using Mayhem for API to check for reliability, performance and security issues in your APIs. 

## About Mayhem for Code

🧪 Modern App Testing: Mayhem for Code is a dynamic testing tool that catches reliability, performance and security bugs before they hit production.

🧑‍💻 For Developers, by developers: The engineers building software are the best equipped to fix bugs, including security bugs. As engineers ourselves, we're building tools that we wish existed to make our job easier!

🤖 Simple to Automate in CI: Tests belong in CI, running on every commit and PRs. We make it easy, and provide results right in your PRs where you want them. Adding Mayhem for API to a DevOps pipeline is easy.

Want to try it? [Sign up for free](http://mayhem.forallsecure.com/) today!

## Usage

Use the Action as follows:

```yaml
name: Example workflow for Mayhem for Code
on: push
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2

    - name: Build your target
      run: ./build_your_target.sh & # <- update this

    - name: Run Mayhem for Code to check for vulnerabilities
      uses: ForAllSecure/mcode-action@v1
      with:
        mayhem-token: ${{ secrets.MAYHEM_TOKEN }}
        mayhem-url: ${{ secrets.MAYHEM_URL }}
```

This repo contains a [full example](workflow.yml) for reference.

The action accepts the follow inputs:

| Required | Input Name | Type | Description | Default
| --- | --- | --- | --- | ---
| ✔️ | `mayhem-token` | string | Mayhem for API service account token | 
| ✔️ | `mayhem-url` | string | URL to your running API. *Example:* http://localhost:8000/api/v1 | 
|   | `duration` | number | Duration of scan, in seconds | 60 
|   | `html-report` | string | Path to the generated SARIF report | 
|   | `sarif-report` | string | Path to the generated HTML report | 

### Getting your Mayhem for Code token

The Actions example above refer to a Mayhem for Code token:

```yaml
with:
  mayhem-token: ${{ secrets.MAYHEM_TOKEN }}
```

You can create a [service account token](https://mayhem4api.forallsecure.com/docs/ch01-03-organizations.html#service-accounts) using the Mayhem for API CLI:

```sh
mapi organization service-account create <your-org> <service-account-name>
```

This will output a token that you can then add as a secret to your GitHub repository or organization.

### Continuing on error

The above examples will fail the workflow when issues are found. If you want to ensure the Action continues, even if Mayhem for Code found issues, then continue-on-error can be used.

```yaml
name: Example workflow for Mayhem for Code
on: push
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2

    - name: Start your API
      run: ./build_your_target.sh & # <- update this

    - name: Run Mayhem for Code to check for vulnerabilities
      uses: ForAllSecure/mcode-action@v1
      continue-on-error: true
      with:
        mayhem-token: ${{ secrets.MAYHEM_TOKEN }}
        mayhem-url: ${{ secrets.MAYHEM_URL }}
```

# Reports

Mayhem for Code generate reports when you pass `sarif-report` or `html-report` to the input. Make sure to pass `continue-on-error` to the Mayhem for Code step if you want to process the reports in follow-up steps.

## Artifact HTML Report

![HTML Report](https://mayhem4api.forallsecure.com/downloads/img/sample-report.png)

To artifact the report in your build, add this step to your pipeline:

```yaml
- name: Run Mayhem for Code to check for vulnerabilities
  uses: ForAllSecure/mcode-action@v1
  continue-on-error: true
  with:
    mayhem-token: ${{ secrets.MAYHEM_TOKEN }}
    mayhem-url: ${{ secrets.MAYHEM_URL }}
    html-report: mcode.html

# Archive HTML report
- name: Archive Mayhem for Code report
  uses: actions/upload-artifact@v2
  with:
    name: mcode-report
    path: mcode.html
```

## GitHub Code Scanning support

![Mayhem for API issue in your PR](http://mayhem4api.forallsecure.com/downloads/img/sarif-github.png)

Uploading SARIF reports to GitHub allows you to see any issue found by Mayhem for API right on your PR, as well as in the "Security" tab of your repository. This currently requires you to have a GitHub Enterprise Plan or have a public repository. To upload the SARIF report, add this step to your pipeline:

```yaml
- name: Run Mayhem for Code to check for vulnerabilities
  uses: ForAllSecure/mcode-action@v1
  continue-on-error: true
  with:
    mayhem-token: ${{ secrets.MAYHEM_TOKEN }}
    mayhem-url: ${{ secrets.MAYHEM_URL }}
    sarif-report: mcode.sarif

# Upload SARIF file (only available on public repos or github enterprise)
- name: Upload SARIF file
  uses: github/codeql-action/upload-sarif@v1
  with:
    sarif_file: mcode.sarif
```