#![allow(dead_code)]

use crate::api::types::{ActionKind, ActionRequest, ApiError, ApiVersion};

pub struct ApiContract;

impl ApiContract {
    pub fn validate_request(json_str: &str) -> Result<ActionRequest, ApiError> {
        let req: ActionRequest =
            serde_json::from_str(json_str).map_err(|e| ApiError::invalid_json(&e.to_string()))?;

        req.validate()?;

        Ok(req)
    }

    pub fn validate_version(version: Option<u32>) -> Result<u32, ApiError> {
        if !ApiVersion::is_valid(version) {
            return Err(ApiError::invalid_version(version));
        }
        Ok(version.unwrap_or(1))
    }

    pub fn validate_kind(kind: &str) -> Result<ActionKind, ApiError> {
        ActionKind::from_str(kind).ok_or_else(|| ApiError::invalid_kind(kind))
    }

    pub fn validate_measure_request(req: &ActionRequest) -> Result<(), ApiError> {
        let kind = Self::validate_kind(&req.kind)?;

        if kind != ActionKind::Measure {
            return Err(ApiError::invalid_params(
                "Expected 'measure' action for measurement request",
            ));
        }

        if req.tool.is_none() && req.params.is_none() {
            return Err(ApiError::invalid_params(
                "Measurement request requires 'tool' or 'params' field",
            ));
        }

        Ok(())
    }

    pub fn validate_tool_request(req: &ActionRequest) -> Result<(), ApiError> {
        let kind = Self::validate_kind(&req.kind)?;

        if kind != ActionKind::Tool {
            return Err(ApiError::invalid_params(
                "Expected 'tool' action for tool request",
            ));
        }

        if req.tool.is_none() && req.tool_action.is_none() {
            return Err(ApiError::invalid_params(
                "Tool request requires 'tool' or 'tool_action' field",
            ));
        }

        Ok(())
    }

    pub fn validate_scenario_request(req: &ActionRequest) -> Result<(), ApiError> {
        let kind = Self::validate_kind(&req.kind)?;

        if kind != ActionKind::Scenario {
            return Err(ApiError::invalid_params(
                "Expected 'scenario' action for scenario request",
            ));
        }

        if req.scenario.is_none() {
            return Err(ApiError::invalid_params(
                "Scenario request requires 'scenario' field",
            ));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_request() {
        let json = r#"{"version": 1, "kind": "step"}"#;
        let result = ApiContract::validate_request(json);
        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_version() {
        let json = r#"{"version": 2, "kind": "step"}"#;
        let result = ApiContract::validate_request(json);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, "ERR_INVALID_VERSION");
    }

    #[test]
    fn test_invalid_kind() {
        let json = r#"{"version": 1, "kind": "invalid_action"}"#;
        let result = ApiContract::validate_request(json);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, "ERR_INVALID_KIND");
    }

    #[test]
    fn test_missing_version() {
        let json = r#"{"kind": "step"}"#;
        let result = ApiContract::validate_request(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_json() {
        let json = "not valid json";
        let result = ApiContract::validate_request(json);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, "ERR_INVALID_JSON");
    }
}
